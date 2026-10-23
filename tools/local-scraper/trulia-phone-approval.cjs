"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const defaultFetch = globalThis.fetch || require("node-fetch");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envFlag(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

function numberFromEnv(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function safeTelegramDescription(payload, fallback) {
  const description = payload?.description;
  return typeof description === "string" && description.trim()
    ? description.trim()
    : fallback;
}

class TelegramApprovalGate {
  constructor(options = {}) {
    const env = options.env || process.env;

    this.enabled = envFlag(env.TRULIA_PHONE_APPROVAL, false);
    this.botToken = String(env.TELEGRAM_BOT_TOKEN || "").trim();
    this.chatId = String(env.TELEGRAM_CHAT_ID || "").trim();
    this.approverUserId = String(env.TELEGRAM_APPROVER_USER_ID || "").trim();
    this.approvalTimeoutMs = numberFromEnv(
      env.TRULIA_APPROVAL_TIMEOUT_SECONDS,
      600,
      30,
      3600
    ) * 1000;
    this.holdMs = numberFromEnv(env.TRULIA_HOLD_MS, 8000, 3000, 15000);
    this.settleTimeoutMs = numberFromEnv(
      env.TRULIA_VERIFY_SETTLE_SECONDS,
      20,
      5,
      60
    ) * 1000;
    this.fetch = options.fetch || defaultFetch;
    this.logger = options.logger || console;
    this.sleep = options.sleep || sleep;
    this.now = options.now || (() => Date.now());
    this.lockPath = options.lockPath || path.join(os.tmpdir(), "trulia-phone-approval.lock");
  }

  validateConfiguration() {
    if (!this.enabled) return;

    const missing = [];
    if (!this.botToken) missing.push("TELEGRAM_BOT_TOKEN");
    if (!this.chatId) missing.push("TELEGRAM_CHAT_ID");
    if (!this.approverUserId) missing.push("TELEGRAM_APPROVER_USER_ID");

    if (missing.length) {
      throw new Error(`TRULIA_PHONE_APPROVAL_CONFIG_MISSING:${missing.join(",")}`);
    }
  }

  async telegram(method, payload = {}) {
    const controller = new AbortController();
    const requestTimeoutMs = method === "getUpdates" ? 30000 : 15000;
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const response = await this.fetch(
        `https://api.telegram.org/bot${this.botToken}/${method}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal
        }
      );

      let body;
      try {
        body = await response.json();
      } catch (_) {
        body = null;
      }

      if (!response.ok || !body?.ok) {
        const description = safeTelegramDescription(body, `HTTP ${response.status}`);
        throw new Error(`Telegram ${method} failed: ${description}`);
      }

      return body.result;
    } finally {
      clearTimeout(timer);
    }
  }

  async acquireLock() {
    const deadline = this.now() + this.approvalTimeoutMs + 60000;

    while (this.now() < deadline) {
      try {
        const handle = fs.openSync(this.lockPath, "wx");
        fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, createdAt: this.now() }));
        return handle;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;

        try {
          const stat = fs.statSync(this.lockPath);
          const staleAfterMs = this.approvalTimeoutMs + 90000;
          if (this.now() - stat.mtimeMs > staleAfterMs) {
            fs.unlinkSync(this.lockPath);
            continue;
          }
        } catch (statError) {
          if (statError?.code !== "ENOENT") throw statError;
        }

        await this.sleep(1000);
      }
    }

    throw new Error("TRULIA_VERIFICATION_APPROVAL_LOCK_TIMEOUT");
  }

  releaseLock(handle) {
    try {
      if (handle != null) fs.closeSync(handle);
    } catch (_) {}

    try {
      fs.unlinkSync(this.lockPath);
    } catch (error) {
      if (error?.code !== "ENOENT") this.logger.warn("Could not remove approval lock:", error.message);
    }
  }

  async prepareUpdateOffset() {
    const updates = await this.telegram("getUpdates", {
      offset: -1,
      limit: 1,
      timeout: 0,
      allowed_updates: ["callback_query"]
    });

    const highest = Array.isArray(updates)
      ? updates.reduce((max, update) => Math.max(max, Number(update.update_id) || 0), 0)
      : 0;

    return highest ? highest + 1 : 0;
  }

  async sendApprovalRequest(context, nonce) {
    const approveData = `trulia:a:${nonce}`;
    const denyData = `trulia:d:${nonce}`;
    const timeoutMinutes = Math.max(1, Math.round(this.approvalTimeoutMs / 60000));

    const message = await this.telegram("sendMessage", {
      chat_id: this.chatId,
      text: [
        "Trulia verification detected.",
        `Location: ${context}`,
        `This approval is single-use and expires in ${timeoutMinutes} minute(s).`
      ].join("\n"),
      reply_markup: {
        inline_keyboard: [[
          { text: "Approve once", callback_data: approveData },
          { text: "Deny", callback_data: denyData }
        ]]
      }
    });

    return {
      messageId: Number(message.message_id),
      approveData,
      denyData
    };
  }

  callbackMatches(callback, messageId) {
    return (
      String(callback?.from?.id || "") === this.approverUserId &&
      String(callback?.message?.chat?.id || "") === this.chatId &&
      Number(callback?.message?.message_id) === Number(messageId)
    );
  }

  async answerCallback(callbackId, text, showAlert = false) {
    await this.telegram("answerCallbackQuery", {
      callback_query_id: callbackId,
      text,
      show_alert: showAlert
    }).catch((error) => this.logger.warn("Could not acknowledge Telegram button:", error.message));
  }

  async closeApprovalMessage(messageId, text) {
    await this.telegram("editMessageReplyMarkup", {
      chat_id: this.chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] }
    }).catch(() => {});

    await this.telegram("editMessageText", {
      chat_id: this.chatId,
      message_id: messageId,
      text
    }).catch((error) => this.logger.warn("Could not update Telegram message:", error.message));
  }

  async waitForDecision(request, initialOffset) {
    let offset = initialOffset;
    const deadline = this.now() + this.approvalTimeoutMs;

    while (this.now() < deadline) {
      const remainingSeconds = Math.max(1, Math.ceil((deadline - this.now()) / 1000));
      const updates = await this.telegram("getUpdates", {
        offset,
        limit: 50,
        timeout: Math.min(20, remainingSeconds),
        allowed_updates: ["callback_query"]
      });

      for (const update of Array.isArray(updates) ? updates : []) {
        offset = Math.max(offset, Number(update.update_id) + 1);
        const callback = update.callback_query;
        if (!callback) continue;

        if (!this.callbackMatches(callback, request.messageId)) {
          if (String(callback.data || "").startsWith("trulia:")) {
            await this.answerCallback(callback.id, "This approval is expired or belongs to another run.", true);
          }
          continue;
        }

        if (callback.data === request.denyData) {
          await this.answerCallback(callback.id, "Denied. The Trulia run will stop.");
          return "deny";
        }

        if (callback.data === request.approveData) {
          await this.answerCallback(callback.id, "Approved once. Completing this verification.");
          return "approve";
        }

        await this.answerCallback(callback.id, "This approval is no longer valid.", true);
      }
    }

    return "timeout";
  }

  async findPressAndHoldButton(page) {
    const frames = typeof page.frames === "function" ? page.frames() : [];
    const selector = 'button, [role="button"], input[type="button"], input[type="submit"]';

    for (const frame of frames) {
      let candidates = [];
      try {
        candidates = await frame.$$(selector);
      } catch (_) {
        continue;
      }

      for (const candidate of candidates) {
        try {
          const label = await candidate.evaluate((element) =>
            String(
              element.innerText ||
              element.textContent ||
              element.value ||
              element.getAttribute("aria-label") ||
              ""
            ).trim()
          );

          if (!/press\s*(?:&|and)\s*hold/i.test(label)) continue;

          const box = await candidate.boundingBox();
          if (box && box.width > 5 && box.height > 5) {
            return { candidate, box, label };
          }
        } catch (_) {}
      }
    }

    return null;
  }

  async pressAndHold(page) {
    if (typeof page.bringToFront === "function") {
      await page.bringToFront();
    }

    const target = await this.findPressAndHoldButton(page);
    if (!target) {
      throw new Error("TRULIA_VERIFICATION_BUTTON_NOT_FOUND");
    }

    const x = target.box.x + target.box.width / 2;
    const y = target.box.y + target.box.height / 2;

    await page.mouse.move(x, y);
    await this.sleep(300);
    await page.mouse.down({ button: "left" });
    try {
      await this.sleep(this.holdMs);
    } finally {
      await page.mouse.up({ button: "left" });
    }
  }

  async waitUntilCleared(isStillBlocked) {
    const deadline = this.now() + this.settleTimeoutMs;
    while (this.now() < deadline) {
      await this.sleep(1000);
      if (!(await isStillBlocked())) return true;
    }
    return false;
  }

  async requestAndSolve({ page, context, isStillBlocked }) {
    if (!this.enabled) return false;

    let lockHandle;
    let request;

    try {
      this.validateConfiguration();
      lockHandle = await this.acquireLock();

      // Another scraper process may have cleared the shared Chrome challenge
      // while this process was waiting for the single approval lock.
      if (!(await isStillBlocked())) return false;

      const offset = await this.prepareUpdateOffset();
      const nonce = crypto.randomBytes(12).toString("hex");
      request = await this.sendApprovalRequest(context, nonce);
      this.logger.log("📲 Phone approval requested through Telegram.");

      const decision = await this.waitForDecision(request, offset);
      if (decision === "deny") {
        await this.closeApprovalMessage(request.messageId, "Trulia verification denied. No action was taken.");
        throw new Error("TRULIA_VERIFICATION_DENIED");
      }

      if (decision === "timeout") {
        await this.closeApprovalMessage(request.messageId, "Trulia verification approval expired. No action was taken.");
        throw new Error("TRULIA_VERIFICATION_APPROVAL_TIMEOUT");
      }

      await this.closeApprovalMessage(request.messageId, "Approved once. Attempting the current Trulia verification…");

      // Fail closed if the page changed between the notification and approval.
      if (!(await isStillBlocked())) {
        await this.closeApprovalMessage(request.messageId, "Verification had already cleared; no click was performed.");
        return true;
      }

      await this.pressAndHold(page);
      const cleared = await this.waitUntilCleared(isStillBlocked);
      if (!cleared) {
        await this.closeApprovalMessage(request.messageId, "Approval received, but Trulia did not clear. The run has stopped.");
        throw new Error("TRULIA_VERIFICATION_STILL_PRESENT");
      }

      await this.closeApprovalMessage(request.messageId, "Trulia verification cleared. Enrichment resumed.");
      this.logger.log("✅ Phone-approved verification cleared.");
      return true;
    } catch (error) {
      const message = String(error?.message || "Unknown approval error");
      process.exitCode = 42;

      if (message.startsWith("TRULIA_VERIFICATION_")) {
        throw error;
      }

      throw new Error(`TRULIA_VERIFICATION_APPROVAL_ERROR:${message}`);
    } finally {
      if (lockHandle != null) this.releaseLock(lockHandle);
    }
  }
}

function createTelegramApprovalGate(options = {}) {
  return new TelegramApprovalGate(options);
}

module.exports = {
  TelegramApprovalGate,
  createTelegramApprovalGate
};
