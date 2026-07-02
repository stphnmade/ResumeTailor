export function cleanJobText(value) {
  return String(value || "")
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function shouldGenerateCoverLetter(choice, inference) {
  if (choice === "include") return true;
  if (choice === "skip") return false;
  return choice === "auto" && inference?.recommended === true;
}

export function cleanDetectionLine(value) {
  return String(value || "")
    .replace(/^[\s\-*•|:]+/, "")
    .replace(/\s+/g, " ")
    .replace(/[|:]+$/g, "")
    .trim();
}

function isLikelyNoiseLine(line) {
  return (
    !line ||
    /^(job description|about (the )?role|about the job|responsibilities|requirements|qualifications|preferred|benefits|location|salary|hours|schedule|people you can reach out to|meet the hiring team|see how you compare to other applicants|see recent hiring trends.*)$/i.test(
      line
    )
  );
}

function isLikelyLocationLine(line) {
  return (
    /\b(remote|hybrid|onsite|on-site)\b/i.test(line) ||
    /\b[A-Z][a-z]+,\s*[A-Z][a-z]+(?:,\s*[A-Z][a-z]+)?\b/.test(line) ||
    /\b[A-Z]{2},\s*(US|USA)\b/i.test(line) ||
    /\bUnited States\b/i.test(line) ||
    /\b[A-Z][a-z]+,\s*[A-Z]{2}\b/.test(line)
  );
}

function isLinkedInMetadataLine(line) {
  return (
    /\b(applicant|applicants|clicked apply|easy apply|save|submitted resume|actively reviewing applicants|promoted by hirer|act\w+ recruit\w+|reposted|posted|1w|2w|3w|1 week|2 weeks|1 month|2 months)\b/i.test(
      line
    ) ||
    /\bsee how you compare to \d+ applicants|you have a preferred skill badge|see recent hiring trends\b/i.test(line) ||
    /\bemployee|employees|software development|premium|school alumni works here|skills match\b/i.test(
      line
    ) ||
    /\b(full-time|part-time|contract|temporary|internship|volunteer|entry level|associate|mid-senior level)\b/i.test(
      line
    ) ||
    /[$€£]\s*\d/i.test(line)
  );
}

function looksLikeRoleLine(line) {
  return /\b(engineer|developer|analyst|manager|specialist|support|administrator|consultant|designer|architect|scientist|coordinator|technician|associate|lead|director|recruiter|writer|editor|intern|assistant|executive|officer|owner|strategist|producer|operator|supervisor|representative|partner|accountant)\b/i.test(
    line
  );
}

function looksLikeCompanyLine(line) {
  return /\b(inc|llc|ltd|corp|company|technologies|technology|systems|solutions|labs|group|partners|university|health|bank|services|studio|media|holdings)\b/i.test(
    line
  );
}

function stripLinkedInSuffixes(value) {
  return String(value || "")
    .replace(/\s*·\s*[A-Z][A-Za-z .'-]+(?:,\s*[A-Z][A-Za-z .'-]+)*(?:\s*\((?:Remote|Hybrid|On-site|Onsite)\))?.*$/i, "")
    .replace(/\s*·\s*(reposted|posted).*/i, "")
    .replace(/\s*·\s*over\s+\d+.*$/i, "")
    .replace(/\s*·\s*(full-time|part-time|contract|temporary|internship|volunteer|entry level|associate|mid-senior level).*/i, "")
    .replace(/\s*·\s*(remote|hybrid|on-site|onsite).*/i, "")
    .replace(/\bjob by\s+/i, "")
    .trim();
}

function cleanDetectedEntity(value, kind) {
  const cleaned = stripLinkedInSuffixes(
    cleanDetectionLine(value)
      .replace(/\b(remote|hybrid|onsite|on-site)\b/gi, "")
      .replace(/\s+\|\s+.*/g, "")
      .replace(/\s+-\s+(remote|hybrid|onsite|on-site).*$/i, "")
      .replace(/\s{2,}/g, " ")
      .trim()
  );

  if (!cleaned || isLikelyNoiseLine(cleaned) || isLinkedInMetadataLine(cleaned)) return "";
  if (kind === "role" && cleaned.length > 100) return "";
  if (kind === "company" && cleaned.length > 80) return "";
  return cleaned;
}

function isPossibleCompanyName(line) {
  const cleaned = cleanDetectedEntity(line, "company");
  return !!cleaned && !looksLikeRoleLine(cleaned) && !isLikelyLocationLine(cleaned);
}

function findExplicitField(jdText, field) {
  const pattern = new RegExp(`(?:^|\\n)\\s*${field}\\s*:\\s*([^\\n]+)`, "i");
  const match = String(jdText || "").match(pattern);
  return match?.[1] ? cleanDetectedEntity(match[1], field === "company" ? "company" : "role") : "";
}

export function extractRoleCompanyFromJD(jd) {
  const raw = String(jd || "");
  const jdText = cleanJobText(raw);
  const lines = raw
    .split(/\r?\n/)
    .map((line) => cleanDetectionLine(line))
    .filter((line) => line && !isLikelyNoiseLine(line));

  const topLines = lines
    .slice(0, 16)
    .map((line) => stripLinkedInSuffixes(line))
    .filter((line) => line && !isLinkedInMetadataLine(line));

  let title = "";
  let role = "";
  let company = "";

  const explicitCompany = findExplicitField(raw, "company");
  const explicitRole = findExplicitField(raw, "role") || findExplicitField(raw, "job title") || findExplicitField(raw, "title") || findExplicitField(raw, "position");

  if (explicitCompany) company = explicitCompany;
  if (explicitRole) {
    title = explicitRole;
    role = explicitRole;
  }

  for (let index = 0; index < Math.min(topLines.length, 8); index += 1) {
    const line = topLines[index];
    const nextLine = topLines[index + 1] || "";

    const joinAsMatch = line.match(/^(.*?)\s+(?:is hiring for|is seeking|seeks|hiring for|hiring)\s+(?:an?\s+)?(.+)$/i);
    if (joinAsMatch?.[1] && joinAsMatch?.[2]) {
      company = company || cleanDetectedEntity(joinAsMatch[1], "company");
      title = title || cleanDetectedEntity(joinAsMatch[2], "role");
      role = role || title;
      if (title || company) break;
    }

    const roleAtCompanyMatch = line.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
    if (roleAtCompanyMatch?.[1] && roleAtCompanyMatch?.[2]) {
      title = title || cleanDetectedEntity(roleAtCompanyMatch[1], "role");
      role = role || title;
      company = company || cleanDetectedEntity(roleAtCompanyMatch[2], "company");
      if (title || company) break;
    }

    if (!title && looksLikeRoleLine(line) && nextLine && isPossibleCompanyName(nextLine)) {
      title = cleanDetectedEntity(line, "role");
      role = role || title;
      company = company || cleanDetectedEntity(nextLine, "company");
      if (title || company) break;
    }

    if (!title && looksLikeRoleLine(line) && nextLine && nextLine.includes("·")) {
      const headerCompany = cleanDetectedEntity(nextLine.split("·")[0], "company");
      if (headerCompany) {
        title = cleanDetectedEntity(line, "role");
        role = role || title;
        company = company || headerCompany;
        if (title || company) break;
      }
    }

    if (!company && isPossibleCompanyName(line) && nextLine && looksLikeRoleLine(nextLine)) {
      company = cleanDetectedEntity(line, "company");
      title = title || cleanDetectedEntity(nextLine, "role");
      role = role || title;
      if (title || company) break;
    }

    const splitMatch = line.match(/^(.+?)\s+(?:@|at|-)\s+(.+)$/i);
    if (splitMatch?.[1] && splitMatch?.[2]) {
      const left = cleanDetectedEntity(splitMatch[1], "role");
      const right = cleanDetectedEntity(splitMatch[2], "company");
      if (!title && looksLikeRoleLine(left)) {
        title = left;
        role = role || left;
      }
      if (!company && right && !isLikelyLocationLine(right)) {
        company = right;
      }
      if (title || company) break;
    }
  }

  if (!company) {
    const companyPatterns = [
      /\b(?:company|organization|employer)\s*:?\s*([A-Z][A-Za-z0-9&.'\- ]{1,80})\b/i,
      /\b(?:about us|about the company)\s*:?\s*([A-Z][A-Za-z0-9&.'\- ]{1,80})\b/i,
      /\bHere at\s+([A-Z][A-Za-z0-9&.'\- ]{1,80})[,.\s]/i,
      /\b([A-Z][A-Za-z0-9&.'\- ]{1,80})\s+is\s+hiring\b/i,
      /\b([A-Z][A-Za-z0-9&.'\- ]{1,80})\s+is\s+seeking\b/i,
      /\bJoin\s+([A-Z][A-Za-z0-9&.'\- ]{1,80})\s+as\b/i,
      /\bSee recent hiring trends for\s+([A-Z][A-Za-z0-9&.'\- ]{1,80}?)(?=[.\n]|$)/i,
      /\bFollow\s+([A-Z][A-Za-z0-9&.'\- ]{1,80}?)(?=\s+to stay up to date|[.\n]|$)/i,
    ];
    for (const pattern of companyPatterns) {
      const match = jdText.match(pattern);
      if (match?.[1]) {
        company = cleanDetectedEntity(match[1], "company");
        break;
      }
    }
  }

  if (!company) {
    const companyLine = topLines.find((line) => isPossibleCompanyName(line));
    if (companyLine) company = cleanDetectedEntity(companyLine, "company");
  }

  if (!title) {
    const rolePatterns = [
      /\bJoin\s+[A-Z][A-Za-z0-9&.'\- ]{1,80}\s+as\s+(?:an?\s+)?([A-Z][A-Za-z0-9/&()\- ]{2,100}?)(?=[.,\n]|$)/i,
      /\b(?:hiring|seeking)\s+an?\s+([A-Z][A-Za-z0-9/&()\- ]{2,100}?)(?=\s+to\b|[.,\n]|$)/i,
      /(?:^|\n)\s*About the job\s*\n\s*([A-Z][A-Za-z0-9/&()\- ]{2,100}?)(?=\s+(?:Location|Company)\s*:|[.,\n]|$)/i,
    ];
    for (const pattern of rolePatterns) {
      const match = raw.match(pattern) || jdText.match(pattern);
      if (match?.[1]) {
        const candidate = cleanDetectedEntity(match[1], "role");
        if (candidate && !isLikelyLocationLine(candidate) && !/\b(time zone|relocation|canada|united states)\b/i.test(candidate)) {
          title = candidate;
          break;
        }
      }
    }
  }

  if (!title) {
    const roleLine = topLines.find(
      (line) => looksLikeRoleLine(line) && !isLikelyLocationLine(line) && !isLinkedInMetadataLine(line)
    );
    if (roleLine) title = cleanDetectedEntity(roleLine, "role");
  }

  role = role || title;

  return { role, company, title };
}
