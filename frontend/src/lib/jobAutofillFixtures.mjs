export const LINKEDIN_AUTOFILL_FIXTURES = [
  {
    name: "company_first_assistant",
    source:
      "https://scrapelead.io/blog/cost-of-posting-job-on-linkedin-full-guide/",
    input: `Project Growth
Creative Marketing Assistant
Nairobi, Nairobi County, Kenya · 1 month ago · Over 100 people clicked apply
$900/month - $1,400/month · Remote
Contract · Entry level
About the job`,
    expected: {
      company: "Project Growth",
      role: "Creative Marketing Assistant",
      title: "Creative Marketing Assistant",
    },
  },
  {
    name: "company_first_executive",
    source:
      "https://www.linkedin.com/pulse/my-experience-posting-unconventional-job-description-ux-mancioppi-paake",
    input: `ACME Corporation
Account Executive (f/m/d)
Berlin, Berlin, Germany · 3 months ago · Over 100 applicants
Hybrid · Full-time · Mid-Senior level
About the job
About The Role`,
    expected: {
      company: "ACME Corporation",
      role: "Account Executive (f/m/d)",
      title: "Account Executive (f/m/d)",
    },
  },
  {
    name: "role_first_with_company_field",
    source:
      "https://www.linkedin.com/posts/shanecopico_careertips-jobsearch-relocation-activity-7381301643801436160--aTj",
    input: `General Manager of Retail
The Connor Group · United States (Remote)
People you can reach out to
Meet the hiring team
About the job
General Manager
Location: Cincinnati, OH - onsite
Company: The Connor Group
This is an onsite position and requires relocation to Cincinnati, OH`,
    expected: {
      company: "The Connor Group",
      role: "General Manager of Retail",
      title: "General Manager of Retail",
    },
  },
  {
    name: "simple_job_card",
    source: "https://www.linkedin.com/help/linkedin/answer/a507990/actively-recruiting-on-linkedin",
    input: `Front End Engineer
Proofpoint
Pittsburgh, PA, US
Actively recruiting
1 week ago · 17 applicants`,
    expected: {
      company: "Proofpoint",
      role: "Front End Engineer",
      title: "Front End Engineer",
    },
  },
  {
    name: "remote_corporate_hr_role",
    source: "https://wetest.io/blog/linkedin-easy-apply/",
    input: `Senior HR Business Partner
Confluence · United States (Remote) 4 days ago · Over 200 applicants
$75,000/yr - $85,000/yr (from job description) · Full-time · Mid-Senior level
501-1,000 employees · Software Development
Actively recruiting
About the job
Remote US or Canada (MUST BE ON EST TIME ZONE)`,
    expected: {
      company: "Confluence",
      role: "Senior HR Business Partner",
      title: "Senior HR Business Partner",
    },
  },
  {
    name: "staff_principal_engineer_with_hiring_team",
    source: "https://voz.vn/t/thread-tong-hop-chia-se-ve-muc-luong-tai-cac-cong-ty-part-2.515355/page-621",
    input: `Axon
Staff / Principal Software Engineer
Ho Chi Minh City, Ho Chi Minh City, Vietnam · Reposted 6 days ago · Over 100 applicants
On-site · Full-time · Director
Meet the hiring team
About the job
Join Axon and be a Force for Good.`,
    expected: {
      company: "Axon",
      role: "Staff / Principal Software Engineer",
      title: "Staff / Principal Software Engineer",
    },
  },
  {
    name: "job_by_company_social_card",
    source: "https://ecommercefastlane.com/linkedin-marketing-how-to-use-a-linkedin-marketing-strategy/",
    input: `Social Media Manager
Job by Brightland
Los Angeles, California, United States`,
    expected: {
      company: "Brightland",
      role: "Social Media Manager",
      title: "Social Media Manager",
    },
  },
  {
    name: "hiring_trends_company_fallback",
    source: "https://www.jobscan.co/blog/linkedin-easy-apply-employers/",
    input: `Staff Accountant
Las Vegas, NV (On-site) 4 weeks ago · Over 200 applicants
Full-time
11-50 employees
See recent hiring trends for Patriot Holdings.
You have a preferred skill badge
Meet the hiring team`,
    expected: {
      company: "Patriot Holdings",
      role: "Staff Accountant",
      title: "Staff Accountant",
    },
  },
  {
    name: "visible_company_compact_card",
    source: "https://www.hyperclapper.com/blog-posts/linkedin-job-announcement-hooks-comments",
    input: `Territory Sales Executive
Red Hat
Copenhagen (Remote)
1 school alumni works here`,
    expected: {
      company: "Red Hat",
      role: "Territory Sales Executive",
      title: "Territory Sales Executive",
    },
  },
  {
    name: "company_not_present_header_only",
    source: "https://www.linkedin.com/posts/daviddobson_easy-apply-job-postings-on-linkedin-may-activity-7366486422234603524-t58i",
    input: `Marketing Manager
United States · Reposted 1 hour ago · Over 100 applicants
Promoted by hirer · Actively reviewing applicants`,
    expected: {
      company: "",
      role: "Marketing Manager",
      title: "Marketing Manager",
    },
  },
  {
    name: "company_not_present_mobile_card",
    source: "https://www.linkedin.com/posts/seth-whitehead-4a0a134b_when-you-say-actively-reviewing-applicants-activity-7353729419770834946-hzBX",
    input: `Country Product Manager
Cape Town, Western Cape, South Africa · 1 week ago · Over 100 applicants
Promoted by hirer · Actively reviewing applicants
Hybrid · Full-time`,
    expected: {
      company: "",
      role: "Country Product Manager",
      title: "Country Product Manager",
    },
  },
];
