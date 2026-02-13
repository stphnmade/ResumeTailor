import unittest

from rae.engine import align_resume, get_aggression_profile
from rae.jd import JDAnalysis
from rae.latex import parse_resume_latex, rebuild_resume


SAMPLE_TEX = r"""
\section{Experience}
\resumeItemListStart
  \resumeItem{Resolved customer escalations and maintained SLA compliance for support queue.}
  \resumeItem{Wrote internal documentation for common troubleshooting workflows.}
  \resumeItem{Built Docker-based local environment for reproducible debugging.}
\resumeItemListEnd

\section{Projects}
\resumeItemListStart
  \resumeItem{Developed a React dashboard for viewing support metrics.}
  \resumeItem{Created ETL scripts in Python for CSV processing.}
\resumeItemListEnd
"""


class TestRAE(unittest.TestCase):
    def test_parse_resume_detects_bullets(self) -> None:
        parsed = parse_resume_latex(SAMPLE_TEX)
        self.assertEqual(len(parsed.blocks), 2)
        self.assertEqual(len(parsed.bullets), 5)

    def test_align_prioritizes_relevant_bullets(self) -> None:
        parsed = parse_resume_latex(SAMPLE_TEX)
        jd = JDAnalysis(
            keywords=["docker", "sla", "escalation", "support"],
            hard_skills=["docker"],
            soft_skills=["documentation"],
            tools=["docker"],
            responsibilities=["handle escalations", "meet sla"],
            seniority="mid",
        )
        result = align_resume(
            parsed,
            jd,
            profile=get_aggression_profile("balanced"),
            max_total_bullets=10,
        )

        exp_bullets = result.selected_by_block[0]
        self.assertGreaterEqual(len(exp_bullets), 1)
        self.assertIn("Docker", exp_bullets[0].content)

    def test_rebuild_reflects_alignment_order(self) -> None:
        parsed = parse_resume_latex(SAMPLE_TEX)
        jd = JDAnalysis(
            keywords=["docker", "container", "support"],
            hard_skills=["docker"],
            soft_skills=[],
            tools=["docker"],
            responsibilities=["support systems"],
            seniority="mid",
        )
        result = align_resume(
            parsed,
            jd,
            profile=get_aggression_profile("balanced"),
            max_total_bullets=10,
        )
        output = rebuild_resume(parsed, result.selected_by_block)

        first = output.find("Docker-based")
        second = output.find("Resolved customer escalations")
        self.assertTrue(first != -1 and second != -1)
        self.assertLess(first, second)

    def test_aggression_profile_changes_default_density(self) -> None:
        parsed = parse_resume_latex(SAMPLE_TEX)
        jd = JDAnalysis(
            keywords=["support"],
            hard_skills=[],
            soft_skills=["support"],
            tools=[],
            responsibilities=["support systems"],
            seniority="mid",
        )
        conservative = align_resume(parsed, jd, profile=get_aggression_profile("conservative"))
        aggressive = align_resume(parsed, jd, profile=get_aggression_profile("aggressive"))
        cons_count = sum(len(v) for v in conservative.selected_by_block.values())
        agg_count = sum(len(v) for v in aggressive.selected_by_block.values())
        self.assertLessEqual(cons_count, agg_count)


if __name__ == "__main__":
    unittest.main()
