# Reddit feedback: reply drafts and recommendations

Drafts for the r/ContextEngineering thread about `ctxcap`. Replies are written as suggestions; adjust any wording to match what has actually been implemented or tested before posting.

## Reply drafts

### u/Tough_Collar_3473

> Good point. Token reduction alone is not enough; a useful trim should also keep the behaviors the rules were protecting. I’m going to add small before/after cases that name the failure being prevented and check whether the relevant instruction still works after a proposed edit. The dependency question is especially useful: preserving a rule’s lines while removing the scope or exception around it could change its meaning, so that deserves an explicit test case.

### u/torvalds75

> Thanks, this distinction between durable invariants and work-specific decisions is helpful. `ctxcap` should help keep the always-loaded file small, but it can’t decide that a project decision belongs there in the first place. I’ll make the docs clearer about keeping task history in issues/ADRs and having agents read it when needed. I’ll also look at adding cases where a suggestion must preserve the surrounding scope or exception, not just the marked rule text. Trailhead is an interesting approach; thanks for sharing it.

### u/ChemicalExcellent463

> I like the “one sentence per rule, add one/remove one” discipline. Keeping the rationale in a history file that isn’t loaded by default also separates the rule from the story behind it. I’ll add this as a practical maintenance recommendation alongside measuring token growth.

### keenDean

> This split makes sense: behavioral guardrails change slowly, while repo state belongs in a manifest that can be loaded only when relevant and checked for drift. `ctxcap` currently focuses on measuring context files and helping trim them safely; it doesn’t provide a hierarchical manifest or SHA-256 drift verification. I’ll make that boundary clear and document the option of moving declarative state out of always-loaded instructions.

### u/JeKoski

> Thanks, the documentation hierarchy and pruning rules are useful ideas. I agree that positive, actionable instructions are easier to follow than a pile of prohibitions. For `ctxcap`, I’ll consider adding a compact “what belongs in the root file” guide: core behavior and pointers there, detailed component docs and task lists in dedicated files with an explicit archive/prune policy.

### u/Weekly-Offer-4172

> “Only things the agent can’t infer from the repo” is a crisp test for whether a rule earns always-loaded space. Build commands, ownership boundaries, and generated-file landmines are good examples; generic style guidance can often live in a linter. I’ll add this as a suggested review question, while keeping the tool focused on reporting size and changes rather than deciding which rules are valuable.

### torrso

> Fair challenge. The audience is people maintaining agent context across repositories, including open-source maintainers; I’m not planning to monetize this. Regex-based preserve checks can only prove that selected text survived, not that its meaning or all important instructions survived. `ctxcap` should state that limitation more plainly and treat verification as a guardrail, not a safety guarantee. I’ll also clarify that a real before/after, including false positives and semantic review, is needed to show the tool’s value. Thanks for calling out the README wording.

### HobbesSR

> Thanks for laying out a practical alternative. A hierarchy with stable identifiers and single sources of truth addresses the root cause of many bloated instruction files, and it complements a budget/checking tool. I’ll add guidance to move detailed subject documentation into linked files and load only the relevant material. The periodic pruning and broken-reference maintenance also fits well with the stale-reference check.

### GreenFuturesMatter

> That’s a fair concern: a tool for managing context can be overkill if someone doesn’t understand their agent setup, and discoverability is a real challenge. I’m aiming this at maintainers who already use repo-level context and want a repeatable CI/review check. I’ll make the intended audience and the concrete use case clearer, and lead with a reproducible example so people can judge whether it helps them.

### lgmarian

> Agreed that keeping `CLAUDE.md` small is foundational advice. The problem I’m targeting is catching growth and risky trims consistently in repo review, especially when a file still looks fine after an important rule disappears. I’ll make that distinction clearer and ensure the project doesn’t imply that a tool replaces a short, well-maintained instruction file.

### u/tariqosmani

> Thanks, these are concrete safeguards. The current workflow already favors line-based edits and reviewing the diff; I’ll emphasize putting critical rules early and checking that preserve spans still survive. A count of protected rules before/after could be useful as a simple check, though it still wouldn’t prove meaning was preserved. The current README includes a measured case study; I’ll keep building on that with examples from independent repositories. The section that grew most in this repo was [fill in after checking the current file history].

### u/kaijurules

> This is a useful separation: durable behavior rules in the instruction file, project facts in a searchable notes vault, and short-lived notes in a bounded recent-memory list. I’ll include it as an architectural option in the guidance, especially for teams where repo facts change more often than agent behavior rules.

## Constructive recommendations to track

1. Add small regression cases that state the failure each instruction prevents, then compare behavior before and after a proposed trim.
2. Test contextual dependencies: ensure scope, exceptions, qualifiers, and nearby explanatory paragraphs are not accidentally removed while preserving a rule’s exact lines.
3. Be explicit that text-preservation checks cannot prove semantic equivalence or completeness. Present verification as a guardrail, and keep human review in the loop.
4. Keep always-loaded instruction files focused on durable invariants and non-inferable facts. Move task-specific decisions, history, and rationale into issues, ADRs, PRs, or separate history files.
5. Separate imperative agent behavior from declarative repository state. Consider a hierarchical, on-demand manifest or searchable notes vault, with drift checks where useful.
6. Prefer concise, actionable positive instructions; retain prohibitions when they express real landmines or hard constraints.
7. Add a review heuristic: “Could the agent infer this from the repository, a linter, or a build script?” If yes, it may not belong in always-loaded context.
8. Document a simple documentation hierarchy, single sources of truth, and pruning/archive rules for TODOs, backlogs, and short-lived memory.
9. Keep edits reviewable: line edits, visible diffs, protected-rule counts, and a deliberate check of any protected-line removal.
10. Strengthen evidence and positioning with reproducible before/after examples from independent repositories, including failure cases/false positives and the plan plus verification results.
11. Clarify the intended audience and the distinction between context-budget tooling and advice to keep instruction files small; explain the open-source use case plainly.

## Follow-up items for this project

- [ ] Add a semantic/context preservation fixture for a rule whose scope or exception is in adjacent text.
- [ ] Review whether a lightweight behavior regression-fixture format fits the project; avoid implying token count is the success metric.
- [ ] Update docs to state the limits of preservation verification and require review of the resulting diff/meaning.
- [ ] Add guidance on what belongs in always-loaded instructions versus task docs, repo manifests, and history.
- [ ] Gather another independent, reproducible before/after case and include false-positive observations.
- [ ] Answer the question about which section grew most only after checking the relevant file’s history.
