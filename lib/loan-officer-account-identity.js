function accountProfile(rows, email) {
  const matches = (Array.isArray(rows) ? rows : []).filter((row) =>
    String(row.email || '').trim().toLowerCase() === String(email || '').trim().toLowerCase());
  // Shared-email and duplicate profiles require an operator to resolve identity.
  if (matches.length !== 1 || (Array.isArray(rows) && rows.length >= 20)) {
    throw Object.assign(new Error('This account needs a unique approved profile. Contact REL8TION for help.'), { status:403 });
  }
  const profile = matches[0];
  if (!profile.uid || !/loan|mortgage/i.test(`${profile.industry || ''} ${profile.title || ''}`)) {
    throw Object.assign(new Error('No approved loan officer profile matches this email.'), { status:403 });
  }
  return profile;
}

module.exports = { accountProfile };
