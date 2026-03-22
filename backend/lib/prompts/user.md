Apply the following authoritative rule documents:

[Tailoring Rules]
{{TAILORING_RULES}}

[Allowed Claims]
{{ALLOWED_CLAIMS}}

[Forbidden Claims]
{{FORBIDDEN_CLAIMS}}

[Formatting Rules]
{{FORMATTING_RULES}}

[ATS Keywords Guidance]
{{ATS_KEYWORDS_GUIDANCE}}

[Canonical Layout Guidance]
{{CANONICAL_RESUME}}

Now optimize the candidate resume for the target job description under those rules.

Target Job Description:
{{JOB_DESCRIPTION}}

Candidate Resume Source Type:
{{RESUME_SOURCE_KIND}}

Primary Resume Input:
{{RESUME_TEX}}

Plain-Text Resume Evidence:
{{RESUME_SOURCE_TEXT}}

Supplemental Context Notes:
{{CONTEXT_NOTES}}

Recruiter Instruction Notes:
{{RECRUITER_NOTES}}

Output requirements:
- Prioritize ATS language alignment while preserving truth.
- Keep the resume to one page; never choose comprehensiveness over page fit.
- Follow recruiter instruction notes only when they are consistent with source truth and the one-page budget.
- Explicitly include support keywords in bullets where supported by existing evidence.
- Keep claims strictly truthful to source material.
- Preserve reverse-chronological ordering inside Experience and Projects unless the canonical source proves a different order.
- If the primary resume input is plain text, convert it into valid compile-safe LaTeX using the canonical layout guidance and only the evidence provided.
- In metadata, explain briefly why the selected experience/project mix is relevant and whether chronology was preserved.
- Return only the required JSON object with metadata.
