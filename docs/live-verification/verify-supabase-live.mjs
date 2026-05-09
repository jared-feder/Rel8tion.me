#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STATUS = Object.freeze({
  PASS: "PASS",
  WARN: "WARN",
  NEEDS_VERIFICATION: "NEEDS_VERIFICATION",
  FAIL: "FAIL"
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const contractPath = path.join(__dirname, "expected-supabase-contract.json");
const jsonReportPath = path.join(__dirname, "latest-live-verification-report.json");
const markdownReportPath = path.join(__dirname, "latest-live-verification-report.md");

const report = {
  generatedAt: new Date().toISOString(),
  mode: "read-only",
  warnings: [
    "This script does not write to Supabase.",
    "This script does not call SMS/outreach Edge Functions.",
    "PASS means the check succeeded under the available access. It does not prove full production behavior."
  ],
  environment: {},
  summary: {
    PASS: 0,
    WARN: 0,
    NEEDS_VERIFICATION: 0,
    FAIL: 0
  },
  checks: []
};

function addCheck(area, name, status, message, details = {}) {
  report.summary[status] += 1;
  report.checks.push({
    area,
    name,
    status,
    message,
    details
  });
}

function getEnv(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function safeOrigin(rawUrl) {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return "";
  }
}

function secretPresence(value) {
  if (!value) return "missing";
  return `present (${value.length} chars)`;
}

function sanitizeBody(text) {
  if (!text) return "";
  let output = String(text);
  const anonKey = getEnv("SUPABASE_ANON_KEY");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (anonKey) output = output.replaceAll(anonKey, "[SUPABASE_ANON_KEY]");
  if (serviceRoleKey) output = output.replaceAll(serviceRoleKey, "[SUPABASE_SERVICE_ROLE_KEY]");
  return output.slice(0, 1200);
}

function isMissingSchemaResponse(result) {
  const body = result.body.toLowerCase();
  return (
    result.status === 404 ||
    body.includes("could not find the table") ||
    body.includes("relation") && body.includes("does not exist") ||
    body.includes("schema cache") && body.includes("not find")
  );
}

function isMissingColumnResponse(result, column) {
  const body = result.body.toLowerCase();
  const lowerColumn = column.toLowerCase();
  return (
    result.status === 400 &&
    (
      body.includes(`'${lowerColumn}'`) ||
      body.includes(`"${lowerColumn}"`) ||
      body.includes(lowerColumn)
    ) &&
    (
      body.includes("could not find") ||
      body.includes("does not exist") ||
      body.includes("schema cache")
    )
  );
}

function isAuthOrPolicyResponse(result) {
  const body = result.body.toLowerCase();
  return (
    result.status === 401 ||
    result.status === 403 ||
    body.includes("permission denied") ||
    body.includes("row level security") ||
    body.includes("42501")
  );
}

function postgrestUrl(baseUrl, table, selectExpression) {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${cleanBase}/rest/v1/${encodeURIComponent(table)}`);
  url.searchParams.set("select", selectExpression);
  url.searchParams.set("limit", "0");
  return url;
}

async function safeFetchJsonless(url, key) {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json"
      }
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body: sanitizeBody(text)
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: sanitizeBody(error?.message || String(error))
    };
  }
}

async function probeTable(baseUrl, key, table) {
  return safeFetchJsonless(postgrestUrl(baseUrl, table, "*"), key);
}

async function probeColumn(baseUrl, key, table, column) {
  return safeFetchJsonless(postgrestUrl(baseUrl, table, column), key);
}

async function verifyTableAndColumns(contract, supabaseUrl, anonKey, serviceRoleKey) {
  const tableEntries = Object.entries(contract.supabase.tables);

  if (!supabaseUrl || !anonKey) {
    addCheck(
      "Supabase env",
      "SUPABASE_URL and SUPABASE_ANON_KEY",
      STATUS.FAIL,
      "Missing SUPABASE_URL or SUPABASE_ANON_KEY; live Supabase checks were not run.",
      {
        SUPABASE_URL: supabaseUrl ? "present" : "missing",
        SUPABASE_ANON_KEY: anonKey ? "present" : "missing"
      }
    );

    for (const [tableName, tableSpec] of tableEntries) {
      addCheck("Supabase table", tableName, STATUS.NEEDS_VERIFICATION, "Skipped because required Supabase env vars are missing.");
      for (const column of tableSpec.columns || []) {
        addCheck("Supabase column", `${tableName}.${column}`, STATUS.NEEDS_VERIFICATION, "Skipped because required Supabase env vars are missing.");
      }
    }
    return;
  }

  addCheck(
    "Supabase env",
    "SUPABASE_URL and SUPABASE_ANON_KEY",
    STATUS.PASS,
    "Required Supabase env vars are present. Full key values were not printed.",
    {
      SUPABASE_URL: safeOrigin(supabaseUrl),
      SUPABASE_ANON_KEY: secretPresence(anonKey)
    }
  );

  if (serviceRoleKey) {
    addCheck(
      "Supabase env",
      "SUPABASE_SERVICE_ROLE_KEY",
      STATUS.WARN,
      "Optional service role key is present. It will be used only for read-only schema probes.",
      {
        SUPABASE_SERVICE_ROLE_KEY: secretPresence(serviceRoleKey)
      }
    );
  } else {
    addCheck(
      "Supabase env",
      "SUPABASE_SERVICE_ROLE_KEY",
      STATUS.NEEDS_VERIFICATION,
      "Optional service role key is not present; checks blocked by anon/RLS cannot be distinguished from hidden schema."
    );
  }

  for (const [tableName, tableSpec] of tableEntries) {
    const anonResult = await probeTable(supabaseUrl, anonKey, tableName);

    if (anonResult.ok) {
      addCheck(
        "Supabase table",
        tableName,
        STATUS.PASS,
        "Anon zero-row PostgREST probe succeeded. This confirms table exposure for this access path, not full RLS behavior.",
        { status: anonResult.status, access: "anon" }
      );
    } else if (serviceRoleKey) {
      const serviceResult = await probeTable(supabaseUrl, serviceRoleKey, tableName);
      if (serviceResult.ok) {
        addCheck(
          "Supabase table",
          tableName,
          STATUS.WARN,
          "Service-role read-only probe confirms the table, but anon could not confirm it. Review RLS/API exposure before changing browser code.",
          {
            anonStatus: anonResult.status,
            serviceStatus: serviceResult.status,
            anonBody: anonResult.body
          }
        );
      } else if (isMissingSchemaResponse(serviceResult)) {
        addCheck(
          "Supabase table",
          tableName,
          STATUS.FAIL,
          "Service-role read-only probe could not find the table.",
          {
            anonStatus: anonResult.status,
            serviceStatus: serviceResult.status,
            serviceBody: serviceResult.body
          }
        );
      } else {
        addCheck(
          "Supabase table",
          tableName,
          STATUS.NEEDS_VERIFICATION,
          "Both anon and service-role probes were inconclusive.",
          {
            anonStatus: anonResult.status,
            serviceStatus: serviceResult.status,
            anonBody: anonResult.body,
            serviceBody: serviceResult.body
          }
        );
      }
    } else if (isMissingSchemaResponse(anonResult)) {
      addCheck(
        "Supabase table",
        tableName,
        STATUS.NEEDS_VERIFICATION,
        "Anon probe indicates this table may be missing or not exposed through PostgREST. Service-role or dashboard inspection is required before calling it missing.",
        { status: anonResult.status, body: anonResult.body }
      );
    } else if (isAuthOrPolicyResponse(anonResult)) {
      addCheck(
        "Supabase table",
        tableName,
        STATUS.NEEDS_VERIFICATION,
        "Anon probe was blocked by auth/RLS. Service-role or dashboard inspection is required.",
        { status: anonResult.status, body: anonResult.body }
      );
    } else {
      addCheck(
        "Supabase table",
        tableName,
        STATUS.NEEDS_VERIFICATION,
        "Anon probe was inconclusive.",
        { status: anonResult.status, body: anonResult.body }
      );
    }

    for (const column of tableSpec.columns || []) {
      const anonColumnResult = await probeColumn(supabaseUrl, anonKey, tableName, column);

      if (anonColumnResult.ok) {
        addCheck(
          "Supabase column",
          `${tableName}.${column}`,
          STATUS.PASS,
          "Anon zero-row column probe succeeded.",
          { status: anonColumnResult.status, access: "anon" }
        );
        continue;
      }

      if (serviceRoleKey) {
        const serviceColumnResult = await probeColumn(supabaseUrl, serviceRoleKey, tableName, column);
        if (serviceColumnResult.ok) {
          addCheck(
            "Supabase column",
            `${tableName}.${column}`,
            STATUS.WARN,
            "Service-role read-only probe confirms the column, but anon could not confirm it.",
            {
              anonStatus: anonColumnResult.status,
              serviceStatus: serviceColumnResult.status,
              anonBody: anonColumnResult.body
            }
          );
        } else if (isMissingColumnResponse(serviceColumnResult, column) || isMissingSchemaResponse(serviceColumnResult)) {
          addCheck(
            "Supabase column",
            `${tableName}.${column}`,
            STATUS.FAIL,
            "Service-role read-only probe could not find this column.",
            {
              anonStatus: anonColumnResult.status,
              serviceStatus: serviceColumnResult.status,
              serviceBody: serviceColumnResult.body
            }
          );
        } else {
          addCheck(
            "Supabase column",
            `${tableName}.${column}`,
            STATUS.NEEDS_VERIFICATION,
            "Column probe was inconclusive even with service-role access.",
            {
              anonStatus: anonColumnResult.status,
              serviceStatus: serviceColumnResult.status,
              anonBody: anonColumnResult.body,
              serviceBody: serviceColumnResult.body
            }
          );
        }
        continue;
      }

      if (isMissingColumnResponse(anonColumnResult, column)) {
        addCheck(
          "Supabase column",
          `${tableName}.${column}`,
          STATUS.NEEDS_VERIFICATION,
          "Anon probe indicates this column may be missing, but service-role or dashboard inspection is required before calling it missing.",
          { status: anonColumnResult.status, body: anonColumnResult.body }
        );
      } else {
        addCheck(
          "Supabase column",
          `${tableName}.${column}`,
          STATUS.NEEDS_VERIFICATION,
          "Anon column probe could not confirm this column. Service-role or dashboard inspection is required.",
          { status: anonColumnResult.status, body: anonColumnResult.body }
        );
      }
    }
  }
}

async function pathExists(relativePath) {
  try {
    await fs.access(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(relativePath) {
  const content = await fs.readFile(path.join(repoRoot, relativePath), "utf8");
  return JSON.parse(content);
}

async function collectFiles(startDir, predicate, out = []) {
  let entries = [];
  try {
    entries = await fs.readdir(startDir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".vercel") continue;
    const fullPath = path.join(startDir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(fullPath, predicate, out);
    } else if (predicate(fullPath)) {
      out.push(fullPath);
    }
  }
  return out;
}

async function fileContains(filePath, regex) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return regex.test(content);
  } catch {
    return false;
  }
}

async function verifyRpcReferences(contract) {
  const sqlFiles = await collectFiles(repoRoot, (file) => file.endsWith(".sql"));
  const sourceFiles = await collectFiles(repoRoot, (file) => /\.(js|cjs|mjs|ts|tsx|html|md|sql)$/i.test(file));

  for (const rpc of contract.supabase.rpcs) {
    const escaped = rpc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const createFunctionRegex = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${escaped}\\b`, "i");
    const referenceRegex = new RegExp(`\\b${escaped}\\b`, "i");

    const definitionMatches = [];
    for (const file of sqlFiles) {
      if (await fileContains(file, createFunctionRegex)) {
        definitionMatches.push(path.relative(repoRoot, file).replaceAll("\\", "/"));
      }
    }

    const referenceMatches = [];
    for (const file of sourceFiles) {
      if (await fileContains(file, referenceRegex)) {
        referenceMatches.push(path.relative(repoRoot, file).replaceAll("\\", "/"));
      }
      if (referenceMatches.length >= 8) break;
    }

    if (definitionMatches.length) {
      addCheck(
        "Supabase RPC",
        rpc,
        STATUS.WARN,
        "Local SQL definition was found, but live RPC deployment was not verified.",
        { definitions: definitionMatches, sampleReferences: referenceMatches }
      );
    } else if (referenceMatches.length) {
      addCheck(
        "Supabase RPC",
        rpc,
        STATUS.NEEDS_VERIFICATION,
        "RPC is referenced locally, but no checked-in SQL definition was found. Verify live RPC definitions in Supabase.",
        { sampleReferences: referenceMatches }
      );
    } else {
      addCheck(
        "Supabase RPC",
        rpc,
        STATUS.NEEDS_VERIFICATION,
        "RPC is part of the expected contract, but no local references or definitions were found. Verify whether it is still required.",
        {}
      );
    }
  }
}

async function verifyEdgeFunctions(contract) {
  for (const edgeFunction of contract.supabase.edgeFunctions) {
    const deployableIndex = `supabase/functions/${edgeFunction.name}/index.ts`;
    const deployableAltJs = `supabase/functions/${edgeFunction.name}/index.js`;
    const docsIndexTs = `docs/supabase-functions/${edgeFunction.name}/index.ts`;
    const docsFlatTs = `docs/supabase-functions/${edgeFunction.name}.ts`;
    const docsFlatJs = `docs/supabase-functions/${edgeFunction.name}.js`;

    const deployableExists = await pathExists(deployableIndex) || await pathExists(deployableAltJs);
    const docsExists = await pathExists(docsIndexTs) || await pathExists(docsFlatTs) || await pathExists(docsFlatJs);

    if (deployableExists) {
      addCheck(
        "Supabase Edge Function",
        edgeFunction.name,
        STATUS.WARN,
        "Deployable local source exists, but live function deployment was not called or verified.",
        {
          safeToCall: edgeFunction.safeToCall,
          reasonNotCalled: edgeFunction.reasonNotCalled
        }
      );
    } else if (docsExists) {
      addCheck(
        "Supabase Edge Function",
        edgeFunction.name,
        STATUS.NEEDS_VERIFICATION,
        "Reference source exists under docs, not deployable supabase/functions. Live deployment must be verified in Supabase.",
        {
          safeToCall: edgeFunction.safeToCall,
          reasonNotCalled: edgeFunction.reasonNotCalled
        }
      );
    } else {
      addCheck(
        "Supabase Edge Function",
        edgeFunction.name,
        STATUS.NEEDS_VERIFICATION,
        "No local function source was found. Live function may still exist, but this repo does not prove it.",
        {
          safeToCall: edgeFunction.safeToCall,
          reasonNotCalled: edgeFunction.reasonNotCalled
        }
      );
    }
  }
}

function normalizeDestination(destination) {
  return String(destination || "").replace(/\/+$/, "");
}

async function verifyVercelRoutes(contract) {
  let vercelConfig;
  try {
    vercelConfig = await readJsonFile("vercel.json");
  } catch (error) {
    addCheck("Vercel config", "vercel.json", STATUS.FAIL, "Could not read root vercel.json.", { error: error.message });
    return;
  }

  const rewrites = Array.isArray(vercelConfig.rewrites) ? vercelConfig.rewrites : [];
  const cleanUrls = vercelConfig.cleanUrls === true;

  addCheck(
    "Vercel config",
    "cleanUrls",
    cleanUrls ? STATUS.PASS : STATUS.WARN,
    cleanUrls ? "cleanUrls is enabled; root a.html and b.html can resolve as /a and /b." : "cleanUrls is not enabled; /a and /b may need explicit rewrites."
  );

  if (Array.isArray(vercelConfig.crons) && vercelConfig.crons.length) {
    addCheck("Vercel config", "crons", STATUS.PASS, "Root vercel.json contains a crons block.", { crons: vercelConfig.crons });
  } else {
    addCheck("Vercel config", "crons", STATUS.NEEDS_VERIFICATION, "Root vercel.json has no crons block. Deployed cron state may differ and must be verified in Vercel.");
  }

  for (const route of contract.vercel.productRoutes) {
    if (route.type === "rewrite") {
      const rewrite = rewrites.find((item) => item.source === route.path);
      if (!rewrite) {
        addCheck("Vercel route", route.path, STATUS.FAIL, "Expected rewrite is missing from root vercel.json.", route);
        continue;
      }

      if (normalizeDestination(rewrite.destination) === normalizeDestination(route.destination)) {
        addCheck("Vercel route", route.path, STATUS.PASS, "Expected rewrite exists in root vercel.json.", {
          destination: rewrite.destination
        });
      } else {
        addCheck("Vercel route", route.path, STATUS.WARN, "Rewrite exists but destination differs from expected contract.", {
          expected: route.destination,
          actual: rewrite.destination
        });
      }

      const destPath = route.destination.replace(/^\//, "");
      if (await pathExists(destPath)) {
        addCheck("Vercel route file", route.destination, STATUS.PASS, "Rewrite destination file exists locally.");
      } else {
        addCheck("Vercel route file", route.destination, STATUS.FAIL, "Rewrite destination file was not found locally.");
      }
    } else if (route.type === "cleanHtml") {
      const exists = await pathExists(route.file);
      if (exists && cleanUrls) {
        addCheck("Vercel route", route.path, STATUS.PASS, "Clean URL route is supported by cleanUrls and the local HTML file exists.", {
          file: route.file
        });
      } else if (exists) {
        addCheck("Vercel route", route.path, STATUS.WARN, "Local HTML file exists, but cleanUrls is not enabled.", {
          file: route.file
        });
      } else {
        addCheck("Vercel route", route.path, STATUS.FAIL, "Expected local HTML file is missing.", {
          file: route.file
        });
      }
    }
  }

  for (const apiRoute of contract.vercel.apiRoutes) {
    if (await pathExists(apiRoute.file)) {
      addCheck("Vercel API route", apiRoute.path, STATUS.PASS, "Expected API route file exists locally.", {
        file: apiRoute.file
      });
    } else {
      addCheck("Vercel API route", apiRoute.path, STATUS.FAIL, "Expected API route file is missing locally.", {
        file: apiRoute.file
      });
    }
  }
}

function verifySecurityBoundaries(contract, serviceRoleKey) {
  for (const check of contract.supabase.securityChecks) {
    if (check.canVerifyFromAnon) {
      addCheck(
        "Security/RLS",
        check.name,
        STATUS.WARN,
        `${check.notes} This script performs this only as a read-only probe.`
      );
    } else if (check.requiresServiceRole && serviceRoleKey) {
      addCheck(
        "Security/RLS",
        check.name,
        STATUS.WARN,
        `${check.notes} Service-role access is present for read-only probes, but RLS policy semantics still need review.`
      );
    } else {
      addCheck(
        "Security/RLS",
        check.name,
        STATUS.NEEDS_VERIFICATION,
        check.notes
      );
    }
  }
}

function renderMarkdown() {
  const lines = [];
  lines.push("# REL8TION Live Verification Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push("Mode: read-only. No Supabase writes were attempted. SMS/outreach functions were not called.");
  lines.push("");
  lines.push("## Environment");
  lines.push("");
  lines.push(`- SUPABASE_URL: ${report.environment.SUPABASE_URL}`);
  lines.push(`- SUPABASE_ANON_KEY: ${report.environment.SUPABASE_ANON_KEY}`);
  lines.push(`- SUPABASE_SERVICE_ROLE_KEY: ${report.environment.SUPABASE_SERVICE_ROLE_KEY}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Status | Count |");
  lines.push("| --- | ---: |");
  for (const status of Object.values(STATUS)) {
    lines.push(`| ${status} | ${report.summary[status]} |`);
  }
  lines.push("");
  lines.push("## Checks");
  lines.push("");
  lines.push("| Area | Check | Status | Message |");
  lines.push("| --- | --- | --- | --- |");
  for (const check of report.checks) {
    const message = String(check.message).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
    lines.push(`| ${check.area} | ${check.name} | ${check.status} | ${message} |`);
  }
  lines.push("");
  lines.push("## Important Limits");
  lines.push("");
  lines.push("- Table/column PASS means a zero-row read probe succeeded under the available key, not that writes or real rows are allowed.");
  lines.push("- Edge Function deployment cannot be proven without Supabase dashboard/API access; this script only checks local source and avoids real SMS sends.");
  lines.push("- RLS policy correctness cannot be proven without privileged policy inspection or a separate non-destructive review process.");
  lines.push("- Vercel route checks read local `vercel.json` and local files; deployed route state still needs Vercel deployment inspection.");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const contract = JSON.parse(await fs.readFile(contractPath, "utf8"));
  const supabaseUrl = getEnv("SUPABASE_URL");
  const anonKey = getEnv("SUPABASE_ANON_KEY");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  report.environment = {
    SUPABASE_URL: supabaseUrl ? safeOrigin(supabaseUrl) : "missing",
    SUPABASE_ANON_KEY: secretPresence(anonKey),
    SUPABASE_SERVICE_ROLE_KEY: secretPresence(serviceRoleKey)
  };

  await verifyTableAndColumns(contract, supabaseUrl, anonKey, serviceRoleKey);
  await verifyRpcReferences(contract);
  await verifyEdgeFunctions(contract);
  verifySecurityBoundaries(contract, serviceRoleKey);
  await verifyVercelRoutes(contract);

  await fs.writeFile(jsonReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(markdownReportPath, renderMarkdown(), "utf8");

  console.log("REL8TION live verification complete");
  console.log(`Mode: ${report.mode}`);
  console.log(`Supabase URL: ${report.environment.SUPABASE_URL}`);
  console.log(`Anon key: ${report.environment.SUPABASE_ANON_KEY}`);
  console.log(`Service role key: ${report.environment.SUPABASE_SERVICE_ROLE_KEY}`);
  console.log(`PASS: ${report.summary.PASS}`);
  console.log(`WARN: ${report.summary.WARN}`);
  console.log(`NEEDS_VERIFICATION: ${report.summary.NEEDS_VERIFICATION}`);
  console.log(`FAIL: ${report.summary.FAIL}`);
  console.log(`JSON report: ${path.relative(repoRoot, jsonReportPath).replaceAll("\\", "/")}`);
  console.log(`Markdown report: ${path.relative(repoRoot, markdownReportPath).replaceAll("\\", "/")}`);

  if (report.summary.FAIL > 0) {
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  addCheck("Script", "unhandled_error", STATUS.FAIL, "The verification script crashed.", {
    error: error?.message || String(error)
  });
  try {
    await fs.writeFile(jsonReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await fs.writeFile(markdownReportPath, renderMarkdown(), "utf8");
  } catch {
    // Keep the catch path quiet; console output below is enough.
  }
  console.error("REL8TION live verification failed to complete.");
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
