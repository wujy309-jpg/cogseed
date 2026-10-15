# Open-Source Security-Scanning Landscape — Research for a Skill Security Scanner Redesign

**Date:** 2026-09-30 · **Scope:** ~60 projects across Groups A–J, plus a deep dive on the emerging *agent-skill scanner* category
**Method & limits:** GitHub metadata via the GitHub REST API and shields.io; file contents via Software Heritage, `ghproxy.net`(raw), jsDelivr, and vendor docs sites. `web_search` was unavailable in this session (HTTP 401), so all findings come from primary sources fetched directly. Star counts are **approximate, rounded, as of 2026-09-30** (shields.io rounds: `19k`, `2.6k`). Where a project's own docs and a third party disagreed, the primary source wins and the discrepancy is flagged (see the OWASP MCP Top 10 note in Group J).

---

## 0. Headline findings — read this first

**The category you are entering already exists and is crowded.** A GitHub search for "agent skill security scanner" returns a dense field of direct competitors, several with substantial traction:

| Project | Stars | Lang | What it is |
|---|---|---|---|
| [NVIDIA/SkillSpector](https://github.com/NVIDIA/SkillSpector) | **19k** | Python | 71 patterns / 17 categories, YARA + AST + taint + LLM, 0–100 score, SARIF, baselines, MCP server mode |
| [Tencent/AI-Infra-Guard](https://github.com/Tencent/AI-Infra-Guard) | 6.6k | Python | Full AI red-team platform; **Skills Scan** + MCP scan + Agent Scan; shipped as ClawHub "EdgeOne Skill Scanner" |
| [snyk/agent-scan](https://github.com/snyk/agent-scan) | 3.1k | Python | Discovers harnesses/MCP servers/skills; scored risk output; has published an agent-skill threat report |
| [invariantlabs-ai/mcp-scan](https://github.com/invariantlabs-ai/mcp-scan) | 3.1k | Python | Static scan + runtime proxy; tool poisoning, toxic flows, rug-pull |
| [cisco-ai-defense/skill-scanner](https://github.com/cisco-ai-defense/skill-scanner) | 2.6k | Python | YAML + **YARA-X** + AST/dataflow + LLM judge + **CEL decision layer**; SARIF; published benchmark numbers |
| [DataDog/guarddog](https://github.com/DataDog/guarddog) | 1.2k | Python | Capability × threat **risk correlation** engine, 0–10 score, YARA rules |
| [highflame-ai/ramparts](https://github.com/highflame-ai/ramparts) | 97 | Rust | **Closest functional match**: MCP + skills, 40 YARA rules, evasion-resistant rescan, OWASP AST tagging, drift detection |
| [T-Zevin/SkillGuardrail](https://github.com/T-Zevin/SkillGuardrail) | 57 | Go | Quarantine → policy verdict → atomic install → drift `verify`; documented rule catalog |
| [Fangcun-AI/SkillWard](https://github.com/Fangcun-AI/SkillWard) | 142 | Python | Static + LLM + **Docker sandbox dynamic verification** |
| [enkryptai/skill-sentinel](https://github.com/enkryptai/skill-sentinel) | 43 | Python | Multi-agent LLM pipeline + VirusTotal for binaries |
| [ryo-ebata/cc-audit](https://github.com/ryo-ebata/cc-audit) | 25 | Rust | Skills + hooks + MCP configs, MIT |

**Four strategic conclusions:**

1. **A static-only scanner is table stakes.** Every serious competitor has moved to a multi-engine pipeline (deterministic rules + AST/dataflow + optional LLM + optional sandbox). SkillWard's Docker sandbox and Snyk's/Cisco's LLM judges are the differentiators.
2. **The unsolved problem is precision, not recall — and it is now measured.** Holzbauer et al., *[Context Matters: Repository-Aware Security Analysis of the Agent Skill Ecosystem](https://arxiv.org/abs/2603.16572)* (arXiv 2603.16572, v2 Jun 2026 — the largest study to date, **238,180 unique skills** across three marketplaces plus GitHub): marketplace scanner reports "classify **up to 46.8%** of skills as malicious, raising concerns about false positives," but after **repository-aware analysis** — checking whether a flagged skill is consistent with its surrounding GitHub project — "**only 0.52% remain suspicious**." The paper's conclusion is blunt: *"existing scanners can substantially overestimate maliciousness when repository context is ignored."* It also documents a real attack vector nobody scans for: **hijacking of skills hosted in abandoned GitHub repositories.** Cisco independently publishes similarly uncomfortable numbers (F1 **47.73%**, recall **31.43%**, precision **99.16%** in-distribution; but on a source-disjoint split F1 **13.74%** / recall **7.75%** — and it **explicitly failed its own promotion gate**). **A ~90× false-positive reduction is available simply from using repository context.** A scanner that is honest about uncertainty and measurably better on precision is a defensible position.
   > ⚠️ **Citation correction:** SkillWard's README attributes the "five scanners / 0.12% flagged by all five / 3.79%–41.93% flag rates" figures to a paper titled *"Malicious Or Not: Adding Repository Context to Agent Skill Classification"* at arXiv 2603.16572. **That title does not match that arXiv ID** (verified: 2603.16572 is *"Context Matters: Repository-Aware Security Analysis of the Agent Skill Ecosystem"*, Holzbauer, Schmidt, Gegenhuber, Schrittwieser, Ullrich), and a title search for "Malicious Or Not" returns no such paper. Do not propagate those secondary figures; use the primary abstract above.

2b. **Published adversarial research shows static scanning is *provably* bypassable.** Two 2026 papers dismantle install-time, appearance-based auditing (details and citations in §E.0). *Cloak and Detonate* reports **Self-Extracting Skill packing bypassing every one of eight scanners at >90%**, and structural obfuscation bypassing **>80% of most static scanners and 96% of a hybrid scanner**, across **1,613 in-the-wild malicious skills**. Any roadmap that stops at better regexes is building a defeated product.
3. **The winning architecture is correlated evidence, not independent regex hits.** GuardDog (capability × threat → risk), SkillSpector (taint flows, chains), Cisco (CEL over typed facts), SkillGuardrail (SG-CHAIN-001/002), Ramparts (undeclared-egress cross-check) all independently converged on *correlating multiple weak signals within a scope* as the primary false-positive reduction mechanism. This should be the architectural centrepiece, not an add-on.
4. **Trust is a lifecycle, not a scan.** The strongest designs (SkillGuardrail, Ramparts, mcp-scan) bind a scan result to a **content fingerprint + source commit + receipt**, then re-verify later to catch **rug pulls**. A one-shot scan cannot detect AML.T0109 (AI Supply Chain Rug Pull).

---

## GROUP A — Static analysis engines / SAST frameworks

### Semgrep — [semgrep/semgrep](https://github.com/semgrep/semgrep)
~17k ★ · C (core) · **LGPL-2.1** · [docs](https://semgrep.dev/docs/)
- **Detects:** pattern-based bug variants across ~30 languages; secrets; supply-chain (SCA) via [semgrep.dev/docs/semgrep-supply-chain/overview](https://semgrep.dev/docs/semgrep-supply-chain/overview/).
- **Rule authoring:** YAML. Ordinary patterns *look like source code* with metavariables (`$X`, `$...ARGS`); plus `pattern-either`, `pattern-not`, `pattern-inside`, `metavariable-regex`, `metavariable-pattern`, and a full **`mode: taint`** with `pattern-sources` / `pattern-sinks` / `pattern-sanitizers` / `pattern-propagators`. Rules compose across files with `pattern-inside` + cross-file taint. This is the single best model for expressing "SKILL.md instruction → tool call" flows.
- **Reporting:** SARIF 2.1.0 via `--sarif`, JSON, text, `--dataflow-traces` for taint paths; `semgrep ci` does diff-aware scanning and PR comments. GitHub-native integration.
- **Scoring:** Rule-level `severity: INFO|WARNING|ERROR` in OSS; the AppSec Platform has separate **severity (Low/Medium/High/Critical)** computed from *Likelihood × Impact* authored per rule, plus an independent **confidence** axis ("the likelihood of the rule to detect true positives") and a separate **impact** field ([findings docs](https://semgrep.dev/docs/semgrep-code/findings/)). The **severity ≠ confidence split is the key idea.**
- **FP reduction:** `# nosemgrep` inline comments; `--severity`/`--exclude-rule` gating; **triage states Open / Reviewing / Ignored / Fixed**; time-period filters ("opened in / triaged in").
- **Worth stealing:** taint mode; the severity×confidence×impact triple; group-by-rule default view; `--autofix`; the rule registry (`--config p/...`) as a distribution channel.

### Opengrep — [opengrep/opengrep](https://github.com/opengrep/opengrep)
~3.1k ★ · OCaml · **LGPL-2.1**
- A community fork of the Semgrep engine, created over licensing/opacity concerns about the original engine; keeps Semgrep rule compatibility. **Lesson:** the rule format is the moat, not the engine — if you design a rule DSL, expect and plan for forking. See [opengrep.dev](https://opengrep.dev/).

### CodeQL — [github/codeql](https://github.com/github/codeql)
~10k ★ · CodeQL (QL) · **MIT** (queries/libraries; the CLI is proprietary-licensed separately)
- **Detects:** deep semantic/dataflow vulnerabilities; powers GitHub code scanning.
- **Rule authoring:** QL — a Datalog-derived logic language. Queries define `from … where … select`, with library-provided `Source`/`Sink`/`Sanitizer` classes and `Configuration` for global dataflow. Far steeper than Semgrep but far more precise. **Query packs** distribute rules with dependency pinning.
- **Reporting:** SARIF 2.1.0 only. Query metadata header (`@name`, `@id`, `@kind`, `@problem.severity`, `@security-severity`, `@precision`, `@tags`) is emitted into `rule.properties`.
- **Scoring:** `@security-severity` is a **CVSS-like 0.0–10.0 float**, mapped by GitHub to critical/high/medium/low (see Group I). `@precision` (`very-high`/`high`/`medium`/`low`) is a second axis controlling default display.
- **FP reduction:** `// codeql[query-id]` inline suppression comments; alert dismissal with a reason and comment; `@precision` gating; per-query severity thresholds.
- **Worth stealing:** `@security-severity` as a *numeric* bridge from your severity model to CVSS-shaped consumers, and `@precision` as a first-class metadata field rather than an afterthought.

### Bandit — [PyCQA/bandit](https://github.com/PyCQA/bandit)
~8.3k ★ · Python · **Apache-2.0** · [plugins](https://bandit.readthedocs.io/en/latest/plugins/index.html) · [config](https://bandit.readthedocs.io/en/latest/config.html)
- **Detects:** Python-specific issues via stable rule IDs: `B1xx` misc, `B2xx` app/framework (B201 flask debug, `B324` hashlib), `B3xx` blacklists (B301–B307 pickle/marshal/`eval`/`exec`), `B4xx` imports (B401–B415), `B5xx` crypto (B501–B509 — weak keys, `ssl._create_unverified_context`, SNMP), `B6xx` injection (B601–B614 — `shell=True`, SQL, YAML load, `mark_safe`), `B7xx` XSS (B701 jinja2 autoescape, B702 mako, B703 django mark_safe).
- **Scoring:** Two orthogonal 3-level axes on every issue — **`issue_severity`: LOW/MEDIUM/HIGH** and **`issue_confidence`: LOW/MEDIUM/HIGH**. Authors set both per plugin. No aggregation formula; consumers threshold on the pair.
- **Reporting:** JSON (`-f json`), text, CSV, XML, YAML, custom formatters; `-ll`/`-lll` severity filters; `--baseline` with a JSON report to show only *new* issues; `# nosec` inline suppression with `Bxxx` codes and an optional justification string; `--exit-zero`; per-test skips in `.bandit`/`pyproject.toml`.
- **Worth stealing:** **the two-axis severity×confidence model is the cheapest large precision win** and it is trivially cheap to implement; `# nosec B301: reason` (code + mandatory free-text justification) is a great suppression UX; `--baseline` as the CI-incremental primitive.

### gosec — [securego/gosec](https://github.com/securego/gosec)
~9k ★ · Go · **Apache-2.0**
- Go AST-based; rule IDs `G101`–`G602` (G101 hardcoded credentials, G104 unhandled errors, G107 URL from tainted input, G201/G202 SQL concat, G204 subprocess with variable, G304 file path from variable, G401–G505 crypto). **Severity LOW/MEDIUM/HIGH + independent confidence LOW/MEDIUM/HIGH** — same two-axis model as Bandit. SARIF via `-fmt=sarif`; `#nosec G304 -- reason` suppressions; `-include`/`-exclude` rule gating; `-track-suppressions` for auditability. Worth stealing: `-track-suppressions` (report what was suppressed, so suppressions can't hide drift).

### njsscan — [ajinabraham/njsscan](https://github.com/ajinabraham/njsscan)
456 ★ · JavaScript · **LGPL-3.0**
- Semgrep-based Node.js SAST with semantic-aware rules over Express/Electron/etc. **Outputs SARIF, JSON, sonarqube, text, and an HTML/`--html` report**; supports `--missing-controls` (a *presence-of-controls* view — reports missing security headers/CSRF protections, not just bad patterns). **Worth stealing:** the missing-controls / negative-assurance view, and the fact that a thin tool can be built entirely on someone else's engine + a good rule pack + multiple renderers.

### Bearer — [Bearer/bearer](https://github.com/Bearer/bearer)
~2.8k ★ · Go · **Elastic License 2.0** (NOT OSI open source — check before copying code)
- "Code security scanning tool (SAST) to discover, filter and **prioritize**" — privacy/security risk focus, with dataflow to sensitive data types. Emphasis is on **filtering and prioritization** rather than raw detection. Supports SARIF, JSON, YAML, GitLab SAST, and a built-in HTML report. **Worth stealing:** its framing — the product is the *filter*, not the detector.

### ast-grep — [ast-grep/ast-grep](https://github.com/ast-grep/ast-grep)
~16k ★ · Rust · **MIT**
- Structural search/lint/rewrite using **tree-sitter** with a pattern syntax that looks like code and metavariables (`$A`, `$$$ARGS`). Rules in YAML with `id`, `language`, `rule` (composed of `pattern`, `kind`, `all`, `any`, `not`, `inside`, `has`, `matches`), `fix`, `severity`, `message`, `note`, `files`, `ignores`. JSON output with byte ranges; `--json=stream`.
- **Worth stealing — this is the highest-leverage single dependency:** ast-grep gives you multi-language structural matching *and rewriting* in one Rust binary with a permissive license. A skill scanner needs to parse Python/Bash/JS/TS/PowerShell/Ruby; ast-grep + tree-sitter covers all of them without you writing six parsers. Pair it with YARA for content-level signatures (see Group D) and you have the deterministic core.
- **Snyk Code (concepts only, no OSS):** commercial; its notable ideas are (a) an interactive **dataflow graph** ("fix analysis" / flow view per finding), (b) **DeepCode AI** interfile analysis, and (c) IDE-first remediation with priority scoring combining severity, reachability, and fix availability. Cite: [Snyk Code docs](https://docs.snyk.io/scan-with-snyk/snyk-code).

---

## GROUP B — Secret scanning

### gitleaks — [gitleaks/gitleaks](https://github.com/gitleaks/gitleaks)
~30k ★ · Go · **MIT**
- **Detects:** ~**222 rules** in the shipped [config](https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml); **130 of them use Shannon `entropy` thresholds** (e.g. the 1Password rule uses `entropy = 3.8`) alongside regexes and `keywords` pre-filters.
- **Rule model:** TOML — `[[rules]]` with `id`, `description`, `regex`, `secretGroup`, `entropy`, `keywords`, `path`, `tags`, plus per-rule `[[rules.allowlists]]`. A global `[allowlist]` block with `paths`, `regexes`, and **`stopwords`**.
- **Reporting:** JSON, SARIF, CSV, JUnit; `--redact` (with `--redact=100` for full redaction) — **essential: never echo a live secret into a report.** Exit codes for CI gating.
- **FP reduction:** `--baseline-path` (a report of accepted findings), **`.gitleaksignore` keyed by finding fingerprint** (stable `file:rule:line` identity), allowlists at both global and rule scope, `--max-decode-depth` bounding recursive decoding.
- **Worth stealing:** entropy × regex × keyword as a *three-signal* detector; `stopwords` as a cheap precision lever in prose (a skill's SKILL.md is prose — stopwords will matter more here than in code); fingerprint-keyed ignore file; `--redact` as a non-negotiable default.

### trufflehog — [trufflesecurity/trufflehog](https://github.com/trufflesecurity/trufflehog)
~28k ★ · Go · **AGPL-3.0** (copyleft — a licensing hazard for a closed product)
- **The killer feature is VERIFICATION:** for 800+ detectors it actually calls the provider API to confirm the credential is *live*, then labels findings **verified vs unverified**. This converts a noisy regex hit into a near-binary truth claim.
- Outputs JSON (JSONL), and supports scanning git history, filesystems, S3, Docker, CI logs. **Worth stealing conceptually:** a "verified/live" axis is the strongest possible confidence signal. You cannot verify an AWS key, but you *can* define weaker analogues: does the URL resolve? is the webhook endpoint real? does the base64 blob decode to something executable? Adopt an explicit **`verified: true|false|unknown`** field.

### detect-secrets — [Yelp/detect-secrets](https://github.com/Yelp/detect-secrets)
~4.6k ★ · Python · **Apache-2.0**
- Plugin architecture (`BasePlugin` with `secret_type`, `denylist`, `secret_scan`), audit workflow, and the **baseline file** pattern: `detect-secrets scan --baseline .secrets.baseline`, then `detect-secrets audit .secrets.baseline` interactively marks each finding **true/false positive**, and the baseline is committed. Subsequent scans report only *new* secrets.
- **Worth stealing:** the **interactive audit → committed baseline** loop. It converts one-time human triage into permanent, reviewable state. Combined with SkillSpector's drift-tolerant glob rules this is the best available FP-suppression design.

### ggshield — [GitGuardian/ggshield](https://github.com/GitGuardian/ggshield)
~2k ★ · Python · **MIT**
- CLI for GitGuardian's 500+ secret types with "advanced checks"; pre-commit hook, GitHub Action, `secret scan`/`secret scan archive`/`secret scan path`/`secret scan docker`. Server-backed (needs an API key for full function), with a secrets-detection engine that includes validity checks. **Worth stealing:** the pre-commit + `--staged`-only ergonomics, and the notion of a **server-side rule feed** so detection improves without a client release (see also repo-forensics' Ed25519-signed rule feed, Group D).

---

## GROUP C — Dependency / SCA & SBOM

### osv-scanner — [google/osv-scanner](https://github.com/google/osv-scanner)
~11k ★ · Go · **Apache-2.0**
- Uses the [OSV.dev](https://osv.dev) database (aggregating GHSA, PyPA, RustSec, Go vuln DB, OSS-Fuzz…). Scans lockfiles, SBOMs, and container images; `--offline` mode with a local DB; `--licenses`.
- **Reporting:** table, JSON, **SARIF**, and CycloneDX/SPDX SBOM output; `--format` selectable.
- **Scoring:** inherits severity from OSV records (CVSS vectors where present).
- **Worth stealing:** OSV is the *right* dependency for a skill scanner — a skill's `requirements.txt`/`package.json`/`npx`/`uvx` launch lines are exactly what OSV covers, it is free, has no auth, and has an offline mode. SkillSpector (SC4), Ramparts, and Cisco's MCP scanner all independently chose OSV.dev. **Do not build your own CVE feed.**

### Trivy — [aquasecurity/trivy](https://github.com/aquasecurity/trivy)
~38k ★ · Go · **Apache-2.0** · [filtering docs](https://trivy.dev/latest/docs/configuration/filtering/) · [reporting docs](https://trivy.dev/latest/docs/configuration/reporting/)
- Broadest scope: `--scanners vuln,misconfig,secret,license`; images, filesystems, repos, K8s, IaC, SBOM.
- **Severity:** `UNKNOWN/LOW/MEDIUM/HIGH/CRITICAL`; each finding carries a `Status` (`affected`, `fixed`, `will_not_fix`, `fix_deferred`, `end_of_life`) and an `Installed Version` / `Fixed Version` pair.
- **Reporting:** `--format table|json|sarif|cyclonedx|spdx|template|github`; `--list-all-pkgs`; `--exit-code`.
- **FP reduction (the best of any tool surveyed):**
  - `--severity HIGH,CRITICAL` filtering.
  - `--ignore-status affected,fixed` and the shorthand **`--ignore-unfixed`** = `--ignore-status affected,will_not_fix,fix_deferred,end_of_life` — *"there is no fix, so this is not actionable today."*
  - `.trivyignore` (one ID per line) **and** `.trivyignore.yaml` with per-entry `id`, `paths`, `purls`, `statement` (free-text justification), and **`expired_at`** — e.g. `- id: CVE-2023-29491 / expired_at: 2023-09-01`.
- **Worth stealing:** **`expired_at` on suppressions is the single best idea in this group.** A suppression without an expiry is a permanent blind spot. Also: `Status` as a first-class field (affected/fixed/will_not_fix) makes "unfixable = deprioritize" a mechanical rule, and the `statement` field makes the suppression auditable.
- [trivy-operator](https://github.com/aquasecurity/trivy-operator) (~2k ★, Apache-2.0) turns the same engine into Kubernetes CRDs — `VulnerabilityReport`, `ConfigAuditReport`, `ExposedSecretReport`, `SbomReport`, `ClusterComplianceReport` — i.e. **scan results as first-class API objects** that any UI can watch. That is a better dashboard substrate than a report file.

### Grype — [anchore/grype](https://github.com/anchore/grype)
~13k ★ · Go · **Apache-2.0**
- Vulnerability scanner over images/filesystems/SBOMs. Table output includes a **`FIXED-IN`** column, which makes remediation actionability visible at a glance. `.grype.yaml` `ignore:` rules with `vulnerability`, `package.name`, `package.version`, and a `reason` field; `--fail-on <severity>`; `--only-fixed`. **Worth stealing:** render the fix, or explicitly render "no fix available" — do not make the user open the finding to learn it is unfixable.

### Syft — [anchore/syft](https://github.com/anchore/syft)
~9.6k ★ · Go · **Apache-2.0** — SBOM generation (CycloneDX, SPDX, Syft JSON) for images/filesystems/dirs. **Worth stealing:** the **SBOM-first decomposition** — enumerate and fingerprint *everything* in the artifact before you judge any of it. A skill's "SBOM" is its file inventory + hashes + declared vs actual capabilities; emit it even when you find nothing, so downtime/coverage is provable.

### OWASP Dependency-Check — [dependency-check/DependencyCheck](https://github.com/dependency-check/DependencyCheck)
~7.7k ★ · Java · **Apache-2.0**
- SCA with **CVSS v2/v3/v4** scoring exposed per finding (`cvssScore`, `cvssV3.baseScore`, `severity`), `--failOnCVSS <n>` to fail a build, and an **XML suppression file** with `<suppress until="2026-01-01Z">` plus `<notes>` — i.e. **time-boxed suppressions in the canonical OWASP tool.** Supports SARIF, HTML, JSON, XML, CSV, JUnit. **Worth stealing:** `failOnCVSS` as an explicit, configurable numeric gate rather than a hardcoded severity list; and the `until` attribute (same idea as Trivy's `expired_at` — two independent tools converged on expiry-dated suppressions, so treat it as validated).

### CycloneDX & SBOM formats
- [CycloneDX](https://cyclonedx.org/) — OWASP SBOM standard; spec versions to 1.6+; JSON/XML/protobuf; **VEX** ([capabilities/vex](https://cyclonedx.org/capabilities/vex/)) with statuses `not_affected`, `affected`, `fixed`, `under_investigation` and a `justification` enum (`code_not_present`, `code_not_reachable`, `requires_configuration`, `requires_dependency`, `requires_environment`, `protected_by_compiler`, `protected_at_runtime`, `protected_at_perimeter`, `protected_by_mitigating_control`).
- [cyclonedx-cli](https://github.com/CycloneDX/cyclonedx-cli) (~545 ★, C#, Apache-2.0) — merge, diff, convert, validate SBOMs. **Worth stealing:** **VEX is how you publish "we looked at this and it doesn't affect us, for this specific reason"** in a machine-readable, standards-track way. It is a far better vehicle for your false-positive/not-applicable decisions than a private ignore file, because it is consumable by customers.
- [SPDX](https://spdx.github.io/spdx-spec/v2.3/) — ISO/IEC 5962; v2.3 and v3.0. Simpler than CycloneDX, licence-centric.
- [pip-audit](https://github.com/pypa/pip-audit) (~1.4k ★, Python, Apache-2.0) — PyPA's OSV-backed auditor; `--fix` auto-upgrades; `--require-hashes`; JSON. [npm audit](https://docs.npmjs.com/cli/commands/npm-audit) — `--omit=dev`, `--audit-level`, `npm audit fix`.

---

## GROUP D — Malware / supply-chain / package-risk heuristics

### GuardDog — [DataDog/guarddog](https://github.com/DataDog/guarddog) ⭐ *the most reusable scoring architecture found*
~1.2k ★ · Python · **Apache-2.0** · v3
Scans PyPI/npm/Go/crates/RubyGems/GitHub Actions/VSCode extensions.

**Architecture — 11 capability rules × ~35 threat rules × 7 metadata analyzers:**
- **Capability rules** (YARA, prefix `capability-`): `filesystem-browser`, `filesystem-delete`, `filesystem-read`, `filesystem-write-executable`, `network-download`, `network-lolbas`, `network-outbound`, `process-hooks`, `process-schedule`, `process-spawn`, `runtime-clipboard`.
- **Threat rules** (YARA, prefix `threat-`): `filesystem-autostart`, `filesystem-destruction`, `filesystem-read`, `network-dns-exfil`, `network-exfil-messenger`, `network-exfil-sysinfo`, `network-exfiltration`, `network-outbound-shady-links`, `network-reverse-shell`, `npm-dependency-confusion`, `npm-http-dependency`, `npm-preinstall-script`, `process-cryptomining`, `process-download-exec`, `process-hooks`, `process-injection-dll`, `process-memory`, `process-powershell-encoded`, `process-spawn-silent`, `process-sysinfo`, `runtime-dynamic-loader`, `runtime-enumeration`, `runtime-environment-read`, `runtime-keylogging`, `runtime-obfuscation-*` (12 variants incl. `-base64exec`, `-chr`, `-dynamic-eval`, `-hidden-code`, `-import-exec`, `-js-mangling`, `-log-suppress`, `-pyarmor`, `-steganography`, `-unicode`), `runtime-screencapture`, `runtime-self-propagation`, `runtime-system-info`, `setup-import-aliasing`, `setup-network-in-install`, `setup-suspicious-imports`.
- **Metadata analyzers** (Python): `bundled_binary`, `deceptive_author`, `metadata_mismatch`, `potentially_compromised_email_domain`, `repository_integrity_mismatch`, `typosquatting`, `unclaimed_maintainer_email_domain`.

**The correlation rule (`can_form_risk`):** a threat and a capability form a **Risk** only if they share a `category` (network/filesystem/process/runtime/system/metadata/setup/npm) *and* their `detail` fields are compatible (either is generic → match; both specific → must be identical). Same-file matches are strong; cross-file matches form risks with **downgraded severity**.

**The scoring formula (`calculate_risk_score`, Factor Rating method, 0–10):**
```
severity_component      = (max_severity / 3) * 0.30      # 30%
chain_component         = chain_value * 0.20             # 20%
specificity_component   = LEVEL_VALUES[dom_specificity] * 0.30   # 30%
sophistication_component= LEVEL_VALUES[dom_sophistication] * 0.20 # 20%
raw = sum; final = round(raw * 10, 1)
# LEVEL_VALUES = {low: 0.3, medium: 0.7, high: 1.0}
# chain_value: 3+ ATT&CK phases = 1.0, 2 = 0.7, else 0.4
#   phases: early(recon,resource-dev,initial-access,execution)
#           mid(persistence,priv-esc,defense-evasion,cred-access,discovery)
#           late(lateral-movement,collection,c2,exfiltration,impact)
#   credential-access + exfiltration ⇒ forced full chain (3)
# Guard: low-specificity-only AND <3 stages AND <3 distinct threat categories ⇒ cap 4.9
# Guard: final >= 7 but no source-code (non-metadata) risk ⇒ cap 6.9
# Labels: 0 = no_risks_detected; <5 low; <7 suspicious; >=7 high_risk
```
- **Reporting:** table, JSON, and **SARIF** (documented GitHub code-scanning upload workflow); `--rules`/`--exclude-rules` selection.
- **Worth stealing — steal this wholesale:** (a) the **capability × threat** model (a network library making HTTP calls is not a finding; a network capability *plus* a shady-link threat in the same file is); (b) the **`detail`-compatibility rule** preventing spurious cross-category correlation; (c) the **two explicit score caps** (`4.9` for low-specificity noise, `6.9` for metadata-only) — these are how you make a 0–10 score defensible; (d) **`specificity` as a 30%-weighted first-class field** — "how specific is this pattern to malware vs legitimate code" is the most honest precision signal anyone in this survey exposed; (e) the `writing-guarddog-rules` **skill shipped in-repo** (`.claude/skills/writing-guarddog-rules/SKILL.md`) — ship a skill that teaches an agent to author your rules.

### YARA — [VirusTotal/yara](https://github.com/VirusTotal/yara) · **yara-x** — [VirusTotal/yara-x](https://github.com/VirusTotal/yara-x)
~9.9k ★ / ~1.3k ★ · C / Rust · **BSD-3-Clause**
- Rule syntax: `rule Name { meta: … strings: $a = "text" nocase wide ascii / $b = { 4D 5A ?? ?? } / $c = /regex/ condition: 2 of them and filesize < 1MB }`. Modules: `pe`, `elf`, `math` (incl. `math.entropy()`), `hash`, `dotnet`, `lnk`, `magic`, `cuckoo`. String modifiers: `nocase`, `wide`, `ascii`, `fullword`, `xor`, `base64`, `base64wide`, `private`.
- yara-x is a memory-safe Rust rewrite with a CLI, a **WASM/bindings** story, better performance, and a rule-linting/formatting toolchain; it can detect bad rules at compile time.
- Distribution: [YARA-Forge](https://github.com/YARAHQ/yara-forge) rule packs, [Neo23x0/signature-base](https://github.com/Neo23x0/signature-base), [awesome-yara](https://github.com/InQuest/awesome-yara).
- **Worth stealing:** YARA is the correct engine for *content-level* malicious indicators (webshells, cryptominers, reverse shells, C2 configs) inside a skill's bundled scripts and binaries, and **the `YARA-Forge` distribution model lets you ingest third-party rules without writing them.** Every serious skill scanner surveyed uses YARA or YARA-X: SkillSpector (YR1–YR4), Cisco, Ramparts (40 rules), GuardDog (~46 rules). Note Ramparts adapted its malware-IOC rules *from* SkillSpector — an OSS rule pack is itself a distribution/authority play.

### ClamAV — [Cisco-Talos/clamav](https://github.com/Cisco-Talos/clamav)
~7.3k ★ · C · **GPL-2.0** (copyleft — linking hazard)
- Signature + heuristic AV with daily-updated CVD signatures, `clamd` daemon, and `clamscan`. Relevant as the **binary-blob** backstop for a skill that ships executables/archives. **Worth stealing:** the *daemon + fresh signatures* operating model, and the honesty that signature scanning is only the first layer (`--heuristic-alerts`, bytecode signatures).

### OpenSSF Scorecard — [ossf/scorecard](https://github.com/ossf/scorecard)
~5.7k ★ · Go · **Apache-2.0** · [checks doc](https://github.com/ossf/scorecard/blob/main/docs/checks.md)
- **20 checks**, each scored **0–10**, each with a declared **Risk level (Critical/High/Medium/Low)** from [`docs/checks/internal/checks.yaml`](https://github.com/ossf/scorecard/blob/main/docs/checks/internal/checks.yaml):
  `Binary-Artifacts` (High), `Branch-Protection` (High), `CI-Tests` (Low), `CII-Best-Practices` (Low), `Code-Review` (High), `Contributors` (Low), `Dangerous-Workflow` (**Critical**), `Dependency-Update-Tool` (High), `Fuzzing` (Medium), `License` (Low), `Maintained` (High), `Packaging` (Medium), `Pinned-Dependencies` (Medium), `SAST` (Medium), `SBOM` (Medium), `Security-Policy` (Medium), `Signed-Releases` (High), `Token-Permissions` (High), `Vulnerabilities` (High), `Webhooks` (**Critical**).
- Weights per check are documented in `checks.yaml` (`scorecard --show-details` exposes them); unknown/unavailable checks score **-1 and are excluded** from the aggregate rather than counted as zero.
- **Worth stealing:** (a) **each check documents its own risk level and rationale** — the score is auditable, not asserted; (b) **-1 for "could not determine"** rather than 0 — it keeps "unknown" from silently reading as "bad" *or* "good"; (c) the check list doubles as a **repo-health scorecard for the skill's source repository**, which is a *second* dimension beyond the skill's own code. A skill from a repo with no branch protection, no review, and unsigned releases is a different risk than the same bytes from a hardened repo. This is the "repository context" that the arXiv 2603.16572 paper argues improves classification.

### Socket.dev (concepts)
Socket ([socket.dev](https://socket.dev/), [SocketDev/socket-cli](https://github.com/SocketDev/socket-cli) ~320 ★ MIT) does not primarily match CVEs — it detects **malicious-package behaviours**: install scripts, `child_process` usage, network/filesystem/shell access, environment-variable reads, obfuscation, `eval`, telemetry, native binaries, manifest anomalies, typosquatting, and "did the package change since I reviewed it". Its UX innovation is **per-alert plain-language explanation + a "why is this risky?" panel + a supply-chain risk score per alert**, and a **"capability" vocabulary** users learn over time.
- **Worth stealing:** the **capability vocabulary** (a small, stable, human-readable set of things code can do) is what makes a report legible to non-experts. Also, "alert reason + explanation + example exploit" per rule.
- **Other supply-chain heuristics worth adopting:** typosquatting via edit distance / homoglyph / keyboard-adjacency / hyphenation against a popular-package list (GuardDog `typosquatting`); **dependency confusion** (internal-scope name published publicly — GuardDog `threat-npm-dependency-confusion`); **repository integrity mismatch** (the tarball doesn't match the repo — GuardDog `repository_integrity_mismatch`); **manifest vs actual capability mismatch** (Ramparts `UndeclaredNetworkEgress`); **deceptive author / metadata mismatch / compromised maintainer email domain** (GuardDog).
- [Pantheon-Security/medusa](https://github.com/Pantheon-Security/medusa) (~1.0k ★, Python, **AGPL-3.0**) claims **40,000+ patterns**, "repo poisoning" detection across **28+ AI editor config file types** (Cursor, Cline, Copilot, Claude Code, Gemini, Kiro), 200 CVE detections, secrets scanning of **agent chat histories and shell history** with **interactive in-place redaction** (mandatory byte-identical backup, JSONL-safe), and JSON/HTML/Markdown/SARIF output. **Worth stealing:** the chat-history/shell-history secret surface is a real, under-served problem; and "byte-identical backup before mutation" is the right safety contract for any auto-fix.
- [alexgreensh/repo-forensics](https://github.com/alexgreensh/repo-forensics) (~183 ★, Python) — "npm audit for AI-agent plugins, skills, and MCP servers": 800+ patterns, **41 correlation rules**, 190+ package IOCs, live CVE + CISA KEV data, **an Ed25519-signed self-updating rule feed**, zero runtime deps, zero telemetry, auto-scan hooks for Claude Code/Codex/Kimi. **Worth stealing:** the **signed rule feed** (rules update without a client release, and forgery is detectable) and the **"zero deps / zero telemetry / fully local"** trust posture — for a security tool that will be pointed at untrusted code, "no network, no deps" is a feature you can market.

---

## GROUP E — LLM / prompt-injection / AI-agent security

### E.0 — The adversarial research literature (read this before designing anything)

There is now a dedicated research field attacking *and* defending agent-skill scanners. Six papers define the real threat model and the real limits of static analysis. **These are the most decision-relevant sources in this entire report.**

| Paper | arXiv | Date | Core claim | Proposed defense |
|---|---|---|---|---|
| **Context Matters: Repository-Aware Security Analysis of the Agent Skill Ecosystem** | [2603.16572](https://arxiv.org/abs/2603.16572) | 2026-03 (v2 06) | 238,180 skills; marketplaces flag **up to 46.8%** as malicious; **repository-aware analysis drops this to 0.52%**. Scanners "substantially overestimate maliciousness when repository context is ignored." Documents **hijacking of skills in abandoned GitHub repos**. | Repository/project context as a first-class input |
| **Semia: Auditing Agent Skills via Constraint-Guided Representation Synthesis** | [2605.00314](https://arxiv.org/abs/2605.00314) | 2026-05 | *"A skill is a hybrid artifact — a structured half declares executable interfaces, while a prose half dictates when and how those interfaces fire — and the prose is **reinterpreted probabilistically on every invocation**. Conventional static analyzers parse the structured half but ignore the prose; LLM-based tools read the prose but cannot reproducibly prove that a tainted input reaches a high-impact sink."* On **13,728 real skills**, "more than half carry at least one critical semantic risk." | **SDL (Skill Description Language)**: lift each skill into a **Datalog fact base** of LLM-triggered actions, prose-defined conditions, and human-in-the-loop checkpoints via **Constraint-Guided Representation Synthesis** (propose-verify-evaluate loop). Security properties — indirect injection, secret leakage, **confused deputies**, unguarded sinks — become **Datalog reachability queries** |
| **Seeing Is Not Screening: Multimodal Hidden Instruction Attacks on Agent Skill Scanners** | [2606.18198](https://arxiv.org/abs/2606.18198) | 2026-06 | Scanners rely on "textual descriptions, manifests, and source code"; **harmful instructions hidden in bundled images bypass scanning** but are recoverable by multimodal agents. Attack (**SkillCamo**) hides payloads in images while rewriting docs to naturally reference them. | **ExecScan**: execution-grounded multimodal scanning — intent extraction, behavior reconstruction, abuse assessment, deliberative execution simulation over docs + code + resources + images |
| **Cloak and Detonate: Scanner Evasion and Dynamic Detection of Agent Skill Malware** | [2607.02357](https://arxiv.org/abs/2607.02357) | 2026-07 | **SkillCloak**, payload-preserving evasion, tested on **8 scanners and 1,613 in-the-wild malicious skills**: *Structural Obfuscation* (semantically equivalent rewrites) bypasses **>80% of most static scanners and 96% of a hybrid scanner**; ***Self-Extracting Skill (SFS) Packing* — which hides malicious components from the install-time view and restores them at agent execution — bypasses *every* scanner at over 90%.** *"Appearance-based auditing is insufficient."* | **SkillDetonate**: behavior-centric **runtime** auditor that executes skills in a sandbox and detects malicious effects via **OS-boundary information-flow evidence** rather than install-time appearance |
| **ColluSkill: Adversarial Cross-Skill Composition for Evading Agent Skill Scanners** | [2608.09732](https://arxiv.org/abs/2608.09732) | 2026-08 | *"Current defenses mainly inspect individual skills, leaving risks from cross-skill composition insufficiently examined… multiple locally plausible skills may pass security checks while collectively forming a harmful workflow."* Decomposes intent into sub-payloads across independently packaged skills; uses **LLM chain planning and *scanner-feedback refinement*** — i.e. an attacker who optimizes against your scanner. Evaluated on **six representative skill scanners**. | **ChainGuard**: context-aware skill-**chain** scanner that jointly analyzes a candidate skill *and the skills already installed*, reconstructing cross-skill dependencies, artifact flows, capability compositions, and downstream behaviours |
| **CompoSkill: Compositional Skill Chain Attacks from Individually Scanner-Passing LLM Agent Skills** | [2608.16246](https://arxiv.org/abs/2608.16246) | 2026-08 | *"A skill may pass the per-skill scanner individually yet participate in a risky composition… This makes **skill composition risk a path-level property rather than a node-level property**, explaining why existing skill scanners that inspect individual packages achieve limited interception."* Builds a **Skill Composition Graph** and searches for high-risk chains. | Path-level / graph-level analysis across the installed skill set |
| **MMSkillRisk: Can Agents Stay Safe When Multimodal Skills Become Traps?** | [2609.35912](https://arxiv.org/abs/2609.35912) | 2026-09 | First benchmark for **image-borne** attacks in multimodal skills: **NCVA** disguises malicious instructions as annotations/interface labels in teaching images. 28 clean skills → 36 attack packages, 108 executable cases, 5 objectives. Across **9 model-harness configurations in isolated sandboxes, NCVA induced unauthorized operations in every configuration**; pooled **ASR 43.1%**, **+16.4 pts over the matched text-carrier baseline**. | Sandboxed execution + multimodal intent extraction |
| **SKILLLITE: Evidence-Guided Malicious Skill Auditing with Compact LLMs** | [2609.36879](https://arxiv.org/abs/2609.36879) | 2026-09 | Compact/local LLMs "struggle to identify malicious behaviours hidden in complex Skill packages" due to implicitness + limited reasoning. Extracts security-relevant behaviours and **infers the intended functionality**, then judges maliciousness **in functional context**. | Evidence-guided agentic pipeline with a *compact* model — relevant if you must run locally/offline |
| **After the Party: Growth, Governance, and Security Scanning in the OpenClaw Agent Skill Ecosystem** | [2609.17274](https://arxiv.org/abs/2609.17274) | 2026-09 | Ecosystem context: the OpenClaw registry nearly doubled in 91 days; **top 10% of skills received 46.93% of all downloads**; **77.86% have zero stars and zero comments**; human scrutiny does not scale. | Governance/registry-level scanning |

**What this literature means for the redesign — five non-negotiable conclusions:**

1. **Install-time appearance is a defeated channel.** SFS packing defeats *every* scanner tested at >90%. **A sandbox/dynamic tier is not a differentiator, it is table stakes** for any claim of detecting determined attackers. SkillWard's Docker sandbox and Cisco's sandboxed PyPI analysis are the right direction; SkillDetonate's framing — **OS-boundary information-flow evidence** rather than "did we see a bad string" — is the right *detection model* for that tier.
2. **Score the *path*, not the *node*.** Composition risk is a path-level property. A per-skill verdict of "PASS" is not a safe ecosystem verdict, and two independent papers show a scanner that only inspects single packages "achieves limited interception." Your data model should support **skill-chain / capability-graph analysis over the installed set**, and your report should be able to say *"this skill is individually fine but composes badly with skill X you already have."*
3. **The prose is the attack surface, and it must be lifted into a queryable form.** Semia's SDL/Datalog approach is the strongest architectural idea in this entire report: parse SKILL.md into a **fact base** (actions, conditions, checkpoints, artifacts), then answer *reachability queries* ("does untrusted input reach a high-impact sink without a human checkpoint?"). Datalog reachability is exactly the right primitive and is far more explainable than a regex or an LLM verdict — and it makes your findings *provable*, which is the thing LLM-only scanners cannot do.
4. **Repository context is worth ~90× on precision** (46.8% → 0.52%). Scorecard-style source-repo trust signals and "is this skill consistent with its project?" checks are not polish — they are the single highest-ROI precision feature available, and they are also what catches abandoned-repo hijacking.
5. **Attackers optimize against your scanner** (ColluSkill's scanner-feedback refinement). Assume your rules are known. This is the argument for: rule content that is not fully public, **signed + updatable rule feeds** (repo-forensics), evasion-resistant normalized/decoded rescanning (Ramparts), behavior-based rather than appearance-based detection, and **versioned scans** so a rule update re-flags previously-passed artifacts.

### E.1 — The direct competitors (skill scanners) — *most important section*

#### NVIDIA/SkillSpector — [NVIDIA/SkillSpector](https://github.com/NVIDIA/SkillSpector) · **19k ★** · Python · Apache-2.0 · v2.12
The reference implementation. "26.1% of skills contain vulnerabilities and **5.2% show likely malicious intent**." Part of an NVIDIA Verified Skills pipeline that **scans, evaluates, and signs** skills before publication to a catalog.

- **Inputs:** git repo, URL, zip, directory, single file. **Hard resource caps, fail-closed:** `INGEST_MAX_BYTES` 100 MiB, `INGEST_MAX_ZIP_MEMBERS` 10,000, `MAX_FILE_BYTES` 1 MB, plus documented parser/ledger/finding ceilings ([ANALYSIS_RESOURCE_BOUNDS.md](https://github.com/NVIDIA/SkillSpector/blob/main/docs/ANALYSIS_RESOURCE_BOUNDS.md)). Breach → `IngestLimitExceededError`. **Zip-bomb and ingest caps are mandatory for a marketplace scanner.**
- **71 patterns across 17 categories**, stable IDs:
  - **Prompt Injection:** P1 Instruction Override, P2 Hidden Instructions, P3 Exfiltration Commands, P4 Behavior Manipulation, P5 Harmful Content, **P9 Whitespace Padding**.
  - **Anti-Refusal:** AR1 Refusal Suppression, AR2 Disclaimer Suppression, AR3 Safety Policy Nullification.
  - **Data Exfiltration:** E1 External Transmission, E2 Env Variable Harvesting, E3 File System Enumeration, E4 Context Leakage.
  - **Privilege Escalation:** PE1 Excessive Permissions, PE2 Sudo/Root Execution, PE3 Credential Access.
  - **Supply Chain:** SC1 Unpinned Dependencies, SC2 External Script Fetching, **SC3 Obfuscated Code (base64/hex)**, **SC4 Known Vulnerable Dependencies (live OSV.dev)**, SC5 Abandoned Dependencies, **SC6 Typosquatting**, SC8 Shipped Python Bytecode, **SC9 Concealed Executable Artifact**.
  - **Excessive Agency:** EA1 Unrestricted Tool Access, EA2 Autonomous Decision Making, EA3 Scope Creep, EA4 Unbounded Resource Access, EA5 External Model/Provider Selection.
  - **Output Handling:** OH1 Unvalidated Output Injection, OH2 Cross-Context Output, OH3 Unbounded Output.
  - **System Prompt Leakage:** P6 Direct Leakage, P7 Indirect Extraction, P8 Tool-Based Exfiltration.
  - **Memory Poisoning:** MP1 Persistent Context Injection, MP2 Context Window Stuffing, MP3 Memory Manipulation.
  - **Tool Misuse:** TM1 Tool Parameter Abuse, TM2 Chaining Abuse, TM3 Unsafe Defaults.
  - **Rogue Agent:** RA1 Self-Modification (CRITICAL), RA2 Session Persistence.
  - **Trigger Abuse:** TR1 Overly Broad Trigger, TR2 Shadow Command Trigger, TR3 Keyword Baiting Trigger.
  - **Behavioral AST:** AST1 `exec()`, AST2 `eval()`, AST3 `__import__()`, AST4 `subprocess`, AST5 `os.system`, AST6 `compile()`, AST7 dynamic `getattr()`, AST8 Dangerous Execution Chain, **AST9 Reflective `getattr()` Sink (`getattr(os,'system')`)** — an explicit anti-evasion rule.
  - **Taint Tracking:** TT1 Direct Taint Flow, TT2 Variable-Mediated Taint Flow, TT3 Credential Exfiltration Chain (CRITICAL), TT4 File Read → Network Exfiltration, TT5 External Input → Code Execution (CRITICAL).
  - **YARA:** YR1 Malware, YR2 Webshell, YR3 Cryptominer, YR4 Hack Tool/Exploit.
  - **MCP Least Privilege:** LP1 Underdeclared Capability, LP2 Wildcard Permission, LP3 Missing Permission Declaration, LP4 Overdeclared Permission.
  - **MCP Tool Poisoning:** TP1 Hidden Instructions (HTML comments, zero-width chars, base64, data URIs), TP2 Unicode Deception (homoglyphs, RTL overrides, mixed-script), TP3 Parameter Description Injection, TP4 Description-Behavior Mismatch (LLM).
- **Scoring:** `CRITICAL +50, HIGH +25, MEDIUM +10, LOW +5`, **× 1.3 if the skill contains executable scripts**, capped at 100. Bands: **0–20 LOW/SAFE · 21–50 MEDIUM/CAUTION · 51–80 HIGH/DO NOT INSTALL · 81–100 CRITICAL/DO NOT INSTALL**. Note the practical consequence: *one* CRITICAL (50) already lands at the top of MEDIUM/CAUTION, and *two* CRITICALs (100) saturate.
- **Reporting:** terminal, **JSON**, **Markdown**, **SARIF**; per-finding `confidence` as a 0.0–1.0 float (`Confidence: 94%`), an `explanation` string, plus `llm_requested`/`llm_available` and `scan_mode` so *"a low score from a static-only scan is never mistaken for a clean full scan"* (a genuinely excellent honesty mechanic). `inference_usage` reports token/cache usage per node.
- **Exit codes:** `0` = score ≤ 50 (SAFE or CAUTION), `1` = score > 50, `2` = error. Docs explicitly warn the exit code collapses SAFE and CAUTION — read `recommendation` from JSON instead. **(Design smell to avoid: make your exit codes map 1:1 onto verdicts.)**
- **Baselines / suppression:** `skillspector baseline ./skill -o .skillspector-baseline.yaml` writes fingerprint suppressions; `scan --baseline … ` reports only NEW findings; `--show-suppressed` reveals them. Two mechanisms: **glob rules over rule-id/path/message** (drift-tolerant) and **exact fingerprints** (evidence-bound — a source or version change keeps the finding active until re-reviewed). Suppressed findings **still appear in SARIF marked with an external suppression**, and in JSON under `suppressed`/`suppressed_count`. The baseline file is auto-excluded from its own scan scope so it cannot create findings against itself. See [SUPPRESSION.md](https://github.com/NVIDIA/SkillSpector/blob/main/docs/SUPPRESSION.md).
- **Also:** ships an **MCP server** (`skillspector mcp`) exposing one tool `scan_skill(target, use_llm, output_format)` returning `risk_score`, `severity`, `recommendation`, `safe_to_install`, `findings` — **so the scanner can gate installs from inside an agent loop.** HTTP transport is unauthenticated by design and **rejects local paths/`file://` over HTTP** to prevent arbitrary host file reads. Also ships a `contrib/batch_scan/` parallel scanner with multi-key pools and zh/ja/ko detection; 11 LLM providers including local CLIs (`claude_cli`, `codex_cli`, `gemini_cli`) with untrusted content delivered only via stdin to a subprocess with restricted capabilities.

#### cisco-ai-defense/skill-scanner — [repo](https://github.com/cisco-ai-defense/skill-scanner) · 2.6k ★ · Python · Apache-2.0
The most methodologically rigorous. Detects prompt injection, data exfiltration, malicious code via **pattern-based detection (YAML + YARA-X) + AST and dataflow analysis + optional LLM-as-a-judge + a bounded CEL decision layer over typed detector facts.**
- **Typed CEL decisions:** uses the official `cel-go` v0.32.0 runtime to *correlate bounded facts* after deterministic detection and before LLM analysis. All bundled CEL rules currently run in **`shadow`** mode — they evaluate and log but do not suppress.
- **Published evaluation with named benchmarks:** core + CEL benchmark = **5,256 malicious / 1,338 benign** MaliciousSkillBench packages; F1 **32.92% → 47.73%**, recall **19.88% → 31.43%**, benign FPR **3.59% → 1.05%**, precision **99.16%**. On a locked **source-disjoint** split: TP=65, FP=42, TN=503, FN=774 → precision 60.75%, recall 7.75%, F1 13.74%, FPR 7.71% — **and it explicitly did not pass its own promotion gate.** Other corpora named: **NotInject** (hard negatives, 0/339 actionable matches), **HarmfulSkillBench** (7/200 actionable), **OpenSkillRisk** (76/263 actionable), plus 111 official Codex/Claude Code/Cursor skills.
- **Reporting:** SARIF for GitHub Code Scanning, reusable GitHub Actions workflow, pre-commit hook, exit codes for build failure. **Plugin architecture** for custom analyzers. Policy configuration via [custom-policy-configuration.md](https://github.com/cisco-ai-defense/skill-scanner/blob/main/docs/user-guide/custom-policy-configuration.md). Supports the [agentskills.io](https://agentskills.io) spec for Codex/Cursor, with `--lenient` for Claude Code `.claude/commands/*.md` and flat markdown repos.
- **Worth stealing — the most important methodological lesson in this report:** **publish your benchmark, your in-distribution AND out-of-distribution numbers, and the fact that a change failed its gate.** "Precision 99.16%" alone is a marketing number; "precision 99.16% in-distribution, 60.75% source-disjoint, and here is why we did not promote" is an engineering artifact. Build the benchmark harness before the rules.

#### highflame-ai/ramparts — [repo](https://github.com/highflame-ai/ramparts) · 97 ★ · Rust · Apache-2.0 · [security-features.md](https://github.com/highflame-ai/ramparts/blob/main/docs/security-features.md)
**The closest functional match to the target product** — same pipeline for MCP servers and skills, first-class [agentskills.io](https://github.com/agentskills/agentskills) bundle support (`<name>/SKILL.md` + sibling `scripts/`, `references/`, `assets/`).
- **40 YARA rules** = 10 skill-targeted + malware-IOC rules **adapted from NVIDIA SkillSpector**. Skill rules: `PromptInjectionSignature`, `UnicodeSteganography`, `CoerciveInjection`, `IndirectPromptInjection`, `CovertExfiltration` (concealment is the discriminator), `AutonomyAbuse`, `CapabilityInflation` (keyword stuffing, "use this first", deceptive certification claims, hidden activation triggers), `SkillCredentialHarvesting` (vendor token formats `AKIA…`, `ghp_…`, `sk-ant-api…`, `sk-proj-…`, `AIzaSy…`, `xox[abprs]-…`, inline PEM blocks, active theft verbs, quoted env-var assignments with non-placeholder values), `SkillToolChainingExfiltration` (credential-file read + egress to Discord webhooks/Telegram bot API/pastebin/ngrok/requestbin/webhook.site), `SkillSystemManipulation` (`dd if=/dev/zero`, `wipefs`, `shred`, `rm -rf /etc`, `chmod 777 /`, `/etc/sudoers`, `/etc/shadow`, `sudo -i`, `runuser`, `doas`, `pkexec`, `LD_PRELOAD=`, PATH poisoning).
- **Evasion-resistant rescan (⭐ best-in-class idea):** every YARA rule also runs over a **normalized view** (invisible/zero-width characters stripped, **NFKC homoglyph folding**) and **iteratively base64/hex-decoded views**, so a keyword split by zero-width chars, spelled in fullwidth homoglyphs, or hidden in an encoded blob still matches. This defeats the most common cheap evasions in one pass and is directly portable.
- **Structural frontmatter heuristics:** `OverbroadAllowedTools` (bare `Bash`, `Bash(*)`, `Bash(*:*)`, `*`, colon-form variants; bounded `Bash(git status:*)` is silent), `DataExfiltrationGrant` (`WebFetch`/`WebSearch`/`Fetch`/`Browse`), `VagueSkillTrigger`, `GenericSkillTrigger` ("help", "do anything"), `SkillNameCollision` (case-insensitive duplicate `name:` across skills → router shadowing).
- **Body heuristics:** `SkillSensitiveFileReference` (Claude Code `@<path>` inlines file contents into context — SSH/AWS/GnuPG/kube/docker creds, `.env`, `.netrc`, `.npmrc`, `.pypirc`, certs), `SkillEmbeddedPayload` (**500+ char base64/hex blob**, excluding `data:image/...;base64,`), `AgentIdentityFileWrite` (writes to `SOUL.md`, `MEMORY.md`, `AGENTS.md`, `CLAUDE.md`, `.claude/settings`, `.cursorrules` — *"content written there survives skill uninstall and is re-loaded into context every session"*; read references are not flagged, only write-verb proximity), `ExternalReferenceInventory` (LOW — inventory of external URL hosts).
- **agentskills.io spec validation:** `AgentskillsNameMismatch` (HIGH — frontmatter `name:` ≠ parent directory name = deception), `AgentskillsInvalidName` (MEDIUM — 1–64 chars, lowercase `[a-z0-9-]`, no leading/trailing or consecutive hyphens), `AgentskillsMissingName`, `AgentskillsUnknownFrontmatterField` (LOW — outside the six-field set `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`; catches a spoofed `risk_tier:` field).
- **Insecure metadata:** `UnsafeYamlDeserialization` (HIGH — `!!python/object`, `!!python/apply`, `!ruby/object`, `!!java`, `!!binary` tags; the scanner itself uses a safe loader, but a PyYAML `FullLoader`/`UnsafeLoader` consumer would execute), `BrandImpersonation` (MEDIUM — brand token + official-sounding cue), `JsonPrototypePollution` (HIGH — `__proto__`/`constructor`/`prototype` keys in bundled `package.json`/`manifest.json`).
- **Cross-checks & drift:** `UndeclaredNetworkEgress` (HIGH — manifest declares no network grant but a bundled script does `curl`/`requests.`/`fetch(`/`axios`/`net/http`/`Invoke-WebRequest`), `SkillContentChanged` (HIGH — baseline drift), **`ScanCoverageIncomplete` (MEDIUM — files skipped ⇒ report the gap as a finding, because "a clean result over a partially-scanned bundle is not evidence the bundle is clean")**, `VulnerableDependency` (OSV.dev, fail-soft).
- **Reporting:** terminal, **JSON, SARIF, Markdown**, with **OWASP MCP Top 10** tags on every finding and **OWASP Agentic Skills Top 10 (AST01–AST10)** tags on skill findings, emitted as URNs (`owasp-mcp-top-10:2025-draft:MCP05`, `owasp-agentic-skills-top-10:2026:AST01`).
- **Worth stealing:** the normalized/decoded rescan; `ScanCoverageIncomplete` as a first-class finding; the declared-vs-actual manifest cross-check; memory/identity-file write detection; name-vs-directory mismatch as deception; and tagging every finding with a *named external taxonomy*.

#### T-Zevin/SkillGuardrail — [repo](https://github.com/T-Zevin/SkillGuardrail) · 57 ★ · Go · Apache-2.0 · [rules.md](https://github.com/T-Zevin/SkillGuardrail/blob/main/docs/rules.md)
**The best product-design thinking.** *"Do not copy a GitHub Skill straight into your agent. Quarantine, scan, decide, then install."* Pipeline: `untrusted source → private quarantine → static scan → policy verdict → explicit approval → atomic install → later verification`. **Never executes package scripts, interpreters, or hooks while inspecting.**
- **Verdicts:** `PASS / REVIEW / BLOCK / CRITICAL` (not a score) — combine rule signals **and capability chains**. States plainly: *"PASS means the enabled rules found no known blocking signal. It is not a safety certificate or a zero-risk claim."*
- **Bindings:** approved installs are tied to **source commit + package fingerprint + external receipt**; `skillguardrail verify` detects later drift. Remote sources resolve to an **immutable commit** before download; `--path` narrows scope but the archive is still acquired at an immutable commit so *"no unreviewed mutable reference is silently followed."*
- **Rule catalog `builtin-v2`** with namespaced stable IDs (`SKILL.md` = `SG-MAN-001…004`; `SG-LIMIT-001…003`; `SG-FILE-001…007` incl. **`SG-FILE-007` Critical: setuid/setgid bits**; `SG-PI-001…005` prompt/agent control incl. **modifying agent identity/memory/policy files** and **retrieving and following mutable external instructions**; `SG-EXEC-001…006` incl. **pipe remote content to interpreter**, **disable host malware/quarantine/firewall controls**; `SG-CRED-001…005` incl. **link-local cloud metadata endpoint**; `SG-NET-001…005`; `SG-OBF-001…004` incl. **invisible or bidirectional Unicode controls**; `SG-PERSIST-001/002`; `SG-SUPPLY-001` package-manager lifecycle hooks; **`SG-CHAIN-001` Critical: sensitive read + outbound transfer in one operation**, **`SG-CHAIN-002` Critical: remote download to a fixed path then passed to an interpreter in the same file**).
- **Fail-closed resource limits:** exceeding entry limits, byte budgets, or **finding-retention limits (512 per package, 16 per rule per path)** fails the scan closed and *does not emit an installable fingerprint*. Remote archives are rejected pre-scan for traversal paths, absolute paths, links, special entries, **case-folding collisions**, excessive depth/entries/bytes/compression ratio.
- **Baselines:** `skillguardrail-baseline/v1` JSON bound to the **complete package fingerprint** and the finding's SHA-256 key; **baselines may never suppress `high` or `critical`** — so they cannot turn a blocked package installable. Accepted findings remain in human reports, JSON/SARIF, and receipts with the review reason.
- **Evidence handling:** bounded excerpts, **known secret formats redacted**, **terminal control characters escaped**, with the explicit warning that "JSON and SARIF consumers must still treat every path and evidence field as attacker-controlled data."
- **Worth stealing:** the **quarantine→verify lifecycle and receipt**; verdicts-not-scores as an option; **"baselines can never suppress high/critical"** (this single rule makes suppression safe); fingerprint-bound baselines; fail-closed limits that *refuse to emit a fingerprint* rather than emit a weak one; and `SG-CHAIN-002`'s deliberate conservatism — *"dynamic shell variables are not guessed… does not upgrade unrelated keywords found in different files into a critical chain. This reduces the package-wide co-occurrence false positives common in simple regex scanners."*

#### Fangcun-AI/SkillWard — [repo](https://github.com/Fangcun-AI/SkillWard) · 142 ★ · Python · Apache-2.0
Static + LLM + **isolated Docker sandbox execution**. Across 5,000 real skills ~**25% flagged unsafe**; among ~38% of suspicious samples that entered the sandbox, **~one-third revealed runtime threats that review-only pipelines could not catch.** Ships a **UI**, is on the Dify Marketplace, and publishes comparison docs with named real-world cases. **Worth stealing:** the honest framing that dynamic verification finds what static review cannot — and that the *increment* is measurable (~1/3 of suspicious skills). Also: sandboxing is the only way to see AML.T0094 (delayed execution) and triggered payloads (`AML.T0051.002`).

#### Others worth noting
- **enkryptai/skill-sentinel** (43 ★): multi-agent LLM pipeline; **VirusTotal integration for binaries before any LLM analysis**; **"No Truncation Limits"** — explicitly markets *not* cutting files off, "catching malicious instructions hidden deep in documentation where other scanners stop looking"; cross-file threat correlation; parallel bulk scanning. **Worth stealing:** truncation is a detection bypass, and "we don't truncate" is a differentiator (but see SkillSpector's bounded-analysis tension — the right answer is *bounded but disclosed*, and a `ScanCoverageIncomplete` finding when you do truncate).
- **snyk/agent-scan** (3.1k ★): discovers harnesses, MCP servers, and skills; v0.6 moves to **risk indicator names + scores**; publishes an agent-skill threat report. Notable safety engineering: warnings that scanning MCP configs **executes commands**, requires explicit per-server consent, `--dangerously-run-mcp-servers` opt-in, refuses destinations resolving to link-local or **cloud metadata endpoints** (`169.254.0.0/16`, `fe80::/10`, `fd00:ec2::254`, `100.100.100.200`), does not follow HTTP redirects, and **documents the residual DNS-rebinding window** between validation and connection. **Worth stealing:** SSRF hardening for any URL-fetching feature, explicit user consent before executing anything, and disclosing the residual risk you could not close.
- **invariantlabs-ai/mcp-scan** (3.1k ★): `scan` (static: tool poisoning, cross-origin escalation, **rug pull**, toxic flows) + `proxy` (continuous monitoring and enforcement: tool-call checking, data-flow constraints, PII detection, indirect prompt injection). **Worth stealing:** static scan + runtime proxy is the natural product arc; "toxic flows" (dangerous *combinations* across tools) is a correlation concept.
- **riseandignite/mcp-shield** (555 ★): tree-style terminal output with per-tool ✓/✗ and per-finding risk; `--safe-list`; and **`--identify-as <client-name>` to make servers reveal client-dependent behaviour (bait-and-switch detection)**. **Worth stealing:** `--identify-as` is a clever, cheap active test; and the ✓/✗ tree is the most legible output format in the survey.
- **cisco-ai-defense/mcp-scanner** (1.1k ★): three engines (YARA, LLM, Cisco AI Defense) usable independently; **pip-audit integration**; **readiness scanning** (zero-dependency static analysis for missing timeouts/retries/error handling); **VirusTotal hash lookups for bundled binaries**; **PyPI scanning inside a Docker sandbox with behavioural analysis**; static/offline mode over pre-generated JSON for air-gapped CI; custom YARA rules.
- **Pantheon-Security/medusa** (1.0k ★, AGPL-3.0): `medusa scan --git <URL>` for AI supply-chain attacks; 28+ AI editor config file types; secrets in agent chat/shell history with interactive redaction; JSON/HTML/Markdown/SARIF.
- **affaan-m/agentshield** (1.2k ★), **splx-ai/agentic-radar** (1.1k ★, LLM agentic workflow scanner), **Nova-Hunting/nova-proximity** (304 ★), **claude-world/claude-skill-antivirus** (80 ★ — "9 engines … across 7 …"), **ryo-ebata/cc-audit** (25 ★ — "AI-free static scanner", an explicit positioning against LLM-based scanners).

### E.2 — LLM/prompt-injection tooling (adjacent, mostly runtime)

- **NVIDIA/garak** — [repo](https://github.com/NVIDIA/garak) ~9.4k ★ · Python · Apache-2.0 — "the LLM vulnerability scanner": a probe/detector/buff architecture that runs *black-box* attacks (prompt injection, jailbreaks, data leakage, hallucination, toxicity, encoding attacks) against a model and scores the hit rate. **Worth stealing:** the **probe × detector matrix** framing and the idea of a *reproducible attack corpus you own* — the static analogue is a corpus of malicious skills rather than malicious prompts.
- **microsoft/PyRIT** — [repo](https://github.com/microsoft/PyRIT) ~4.6k ★ · Python · MIT (the `Azure/PyRIT` repo is archived at 116 ★) — Microsoft's Python Risk Identification Toolkit: orchestrators, converters (encoding/obfuscation transforms), targets, and scorers for multi-turn red teaming. **Worth stealing:** **converters as first-class objects** — the same payload through base64/ROT13/homoglyph/zero-width/leetspeak transforms, which is exactly the evasion-rescan idea Ramparts applies in the other direction.
- **promptfoo** — [repo](https://github.com/promptfoo/promptfoo) ~26k ★ · TypeScript · MIT — eval + red-team framework for prompts/agents/RAG with a web UI, assertions, model comparison, and a red-team plugin set (hundreds of vulnerability types). **Worth stealing:** the **assertion DSL + shareable eval config + HTML report** triple; and "red team as a CI job with a diffable result set."
- **protectai/llm-guard** — [repo](https://github.com/protectai/llm-guard) ~3.2k ★ · Python · MIT (**archived**) — input/output scanners: `PromptInjection`, `Toxicity`, `Secrets`, `BanTopics`, `BanSubstrings`, `Code`, `Language`, `Gibberish`, `InvisibleText`, `TokenLimit`, plus output scanners (`Sensitive`, `NoRefusal`, `Bias`, `Relevance`, `MaliciousURLs`, `URLReachability`). **Worth stealing — several directly portable detectors:** `InvisibleText` (zero-width/Unicode-tag stripping), `BanSubstrings`, `Secrets`, `Code`, and especially **`URLReachability`** and **`NoRefusal`** (detecting refusal-suppression in output ⇒ the static analogue AR1/AR2).
- **protectai/rebuff** — [repo](https://github.com/protectai/rebuff) ~1.5k ★ · TypeScript · Apache-2.0 (**archived**) — layered prompt-injection detector: heuristics → LLM-based detection → **canary tokens** → a vector-DB of known attacks. **Worth stealing:** the **canary-token** concept and the "known-attack similarity search" idea — both map onto a skill scanner as "does this instruction set resemble a known-bad corpus."
- **deadbits/vigil-llm** — [repo](https://github.com/deadbits/vigil-llm) ~496 ★ · Python · Apache-2.0 — scanners: `YaraScanner` (YARA rules over prompts!), `TransformerScanner`, `VectorScanner` (embedding similarity against attack DBs), `PromptInjection`, `CanaryScanner`, plus a "vectordb" of jailbreaks; API + CLI. **Worth stealing:** *running YARA over prompt text* — a direct precedent for YARA-over-SKILL.md, which Ramparts and Cisco both do in production.
- **NVIDIA/NeMo-Guardrails** — [repo](https://github.com/NVIDIA/NeMo-Guardrails) ~7.2k ★ · Python — programmable rails: Colang flows, input/output/dialog/execution rails, and **"guardrails as code"** with a config DSL. **Worth stealing:** the rail taxonomy (*input / output / dialog / execution / retrieval*) is a clean way to organize a skill's risk surface too.
- **Giskard** — [repo](https://github.com/Giskard-AI/giskard-oss) ~5.8k ★ · Python · Apache-2.0 — testing/scanning for ML & LLM apps; generates adversarial test suites and reports by risk category (performance, robustness, bias, hallucination, **security/prompt injection**). **Worth stealing:** *auto-generated* test cases per detected vulnerability class.
- **protectai/modelscan** — [repo](https://github.com/protectai/modelscan) ~777 ★ · Python · Apache-2.0 — scans serialized models (pickle, H5, SavedModel, ONNX) for **unsafe operators** before loading; middleware for Keras/PyTorch. **Worth stealing:** an **"unsafe operator denylist"** for deserialization. The skill-scanner analogue is exactly this, applied to `pickle`, `torch.load`, `joblib`, `dill`, `marshal`, `yaml.load`, and `node-serialize`.
- **trailofbits/fickling** — [repo](https://github.com/trailofbits/fickling) ~670 ★ · Python · LGPL-3.0 — a **pickle decompiler and static analyzer**: disassembles a pickle into readable pseudo-Python and flags dangerous opcodes (`GLOBAL`, `REDUCE`, `BUILD`, `STACK_GLOBAL` → `os.system`, `subprocess`, `eval`). **Worth stealing:** this is the canonical implementation of *"show the human what this blob actually does"* — a "decompile the obfuscated payload" capability is a major differentiator that almost no skill scanner has.
- **Tencent/AI-Infra-Guard** — [repo](https://github.com/Tencent/AI-Infra-Guard) ~6.6k ★ · Python · Apache-2.0 — full AI red-team platform: ClawScan (OpenClaw security scan), Agent Scan, AI infra vuln scan, **MCP Server & Agent Skills scan**, and jailbreak evaluation. Black Hat EU '25 Arsenal; shipped on ClawHub as **EdgeOne Skill Scanner** / **EdgeOne ClawScan** / **AIG Scanner**; 9 languages of README. **Worth stealing:** the platform/console packaging and the multi-surface product naming; a plugin distributed *into* a marketplace is a distribution channel worth copying.
- **AgentDojo** — [ethz-spylab/agentdojo](https://github.com/ethz-spylab/agentdojo) ~878 ★ — a benchmark for prompt-injection attacks and defenses in tool-using agents (attacks, defenses, tasks, security test suites). **Worth stealing:** the *benchmark-as-product* posture for the agent-security space.
- **InjecAgent** — [uiuc-kang-lab/InjecAgent](https://github.com/uiuc-kang-lab/InjecAgent) ~172 ★ — benchmark of **indirect** prompt injection against tool-integrated agents (1,054 test cases, 17 user tools, 62 attacker tools, "data-stealing" and "direct-harm" attack types). **Worth stealing:** the *indirect* framing — a skill's instructions are learned from third-party content, so indirect injection (AML.T0051.001) is the primary threat, not direct.

---

## GROUP F — Code-scanning UX / aggregation platforms

### DefectDojo — [DefectDojo/django-DefectDojo](https://github.com/DefectDojo/django-DefectDojo) ~5k ★ · Python · BSD-3-Clause · [docs](https://docs.defectdojo.com/)
OWASP Flagship. *"DefectDojo does not scan. It imports findings from **500+ security tools**, normalizes them, and deduplicates them within a tool, across tools and across reimports, so each vulnerability reaches remediation as one active Finding."*
- **Deduplication:** algorithm selectable **per parser** via `DD_DEDUPLICATION_ALGORITHM_PER_PARSER` ∈ {`unique_id_from_tool`, `hash_code`, `unique_id_from_tool_or_hash_code`, `legacy`}; hash fields configurable per scanner (`HASHCODE_FIELDS_PER_SCANNER`) with **always-included fields** (e.g. `service`); optional endpoint-based dedupe; **Dedupe Pools** to group assets. There is a documented **"identity signature ledger"** that bridges identity changes across versions — and release notes explicitly call out which upgrades change a parser's finding identity. **SARIF-family parsers "stop trusting fingerprints that repeat within a report, which stops unrelated findings from being merged"** — a superb, specific dedup/FP insight.
- **Location Drift Matching (Pro):** track findings as locations move across reimports — *"line shifts, file renames, URL moves, and dependency version bumps no longer close and recreate findings."*
- **False Positive History:** *"Automatically mark new Findings as false positive when a matching Finding was already triaged that way."* **This is the highest-value FP-reduction mechanism in the whole survey** and it is trivially implementable once you have stable finding identity.
- **Reimport:** importing a new scan of the same engagement **closes findings that are no longer present** and re-opens regressions — the "scan as a state transition" model.
- Also: **Risk Acceptances** with expiry; **SLA Configuration** per asset/severity (plus FedRAMP presets); "Similar Findings" manual duplicate linking; **multiple CWEs per finding** (`Finding_CWE`); Jira/ServiceNow ticketing; "My Work" per-user triage queue; Sensei Advisor recommending dedup/prioritization settings.

### Semgrep AppSec Platform UI
Faceted findings list (status, severity, confidence, rule, project, time period, **Multimodal autotriage ⇒ True/False positive**); default **group-by-rule** view sorted by severity then finding count; triage states **Open/Reviewing/Ignored/Fixed**; "opened in / triaged in" time filters that run *before* other filters. Policies page for gating. Reachability on supply-chain findings: **reachable / conditionally reachable / unreachable / no reachability analysis** — and the explicit rule that *"a finding is always reachable if the only way to fix the vulnerability is to upgrade the dependency."*

### GitHub code scanning UI
- Alert list with faceting by rule, severity, tool, branch; "Security" tab; Security Overview / posture pages.
- Dismissal with a **reason** (`false positive`, `won't fix`, `used in tests`) **and a required comment**; re-open on regression. Inline suppressions via `// codeql[query-id]` / `# codeql[query-id]`.
- `security-severity` maps a numeric 0.0–10.0 onto buckets (Group I). `precision` controls default display. Default setup + autofix suggestions.
- **What is good:** dismissal reasons are structured and auditable; alerts persist across commits via fingerprints. **What is bad:** the `security-severity` funnel hides the tool's own semantics; alert lists become unmanageable without aggressive dedup; there is no notion of "this artifact is not installable" — only "there are N alerts."

### Trivy / trivy-operator
`trivy-operator` exposes reports as CRDs (`VulnerabilityReport`, `ConfigAuditReport`, `ExposedSecretReport`, `SbomReport`, `ClusterComplianceReport`) — **findings as API objects, not files.** The best substrate for a live dashboard, and the reason its dashboard can show drift natively.

### SARIF viewers
[`microsoft/sarif-web-component`](https://github.com/microsoft/sarif-web-component), [`microsoft/sarif-tutorials`](https://github.com/microsoft/sarif-tutorials), [`psastras/sarif-rs`](https://github.com/psastras/sarif-rs), and the VS Code SARIF Viewer extension. A good viewer shows: rule metadata with `helpUri`, the **code flow / dataflow trace** for taint findings, the source snippet with the region highlighted, related locations, and the `fix` diff when present.

**Faros:** the community-edition repo referenced in the brief does not resolve (`faros-ai/faros-community-edition` → Not Found). Faros AI ([faros.ai](https://www.faros.ai/)) is a commercial engineering-intelligence platform; its relevant concept is **normalizing findings across tools into a single "work item" model joined to engineering telemetry** (DORA, ownership, sprint data) so risk can be attributed to teams and sprints. Cite the vendor docs rather than a repo.

---

## GROUP G — Skill/plugin marketplace gateways & supply-chain policy

- **sigstore/cosign** — [repo](https://github.com/sigstore/cosign) ~6.3k ★ · Go · Apache-2.0 — **keyless signing**: OIDC identity → Fulcio short-lived certificate → signature + cert recorded in the **Rekor transparency log** → stored as a **Sigstore bundle** alongside the artifact. Verification requires the expected `--certificate-identity` and `--certificate-oidc-issuer`. `cosign verify-attestation` verifies **in-toto attestations** (e.g. SLSA provenance) rather than just the signature. Docs: [docs.sigstore.dev](https://docs.sigstore.dev/). **Worth stealing:** "signed by the marketplace pipeline, identity pinned to the CI workflow" is the correct trust anchor for a curated skill catalog; and transparency-log inclusion means a signature cannot be back-dated invisibly. Note the user-facing honesty in the CLI: it warns that the identity *"will be stored in public transparency logs and cannot be removed later."*
- **in-toto** — [in-toto.io](https://in-toto.io/) ~1.0k ★ · Python — a framework for supply-chain integrity: a **layout** names the steps, the functionaries, and the artifact rules; each step emits a **link** metadata file; the layout is signed by the project owner. **Worth stealing:** in-toto's model maps exactly onto *skill authoring → review → scan → sign → publish → install*, with each step producing signed evidence that the next step verifies.
- **SLSA** — [slsa.dev/spec/v1.0/levels](https://slsa.dev/spec/v1.0/levels) ~1.9k ★ — Build levels L1 (provenance exists), L2 (hosted build platform, signed provenance), L3 (hardened builds, non-forgeable provenance). **Worth stealing:** SLSA is the *vocabulary* for "how much do we trust the build"; a marketplace can require L2+ provenance for published skills, and display the level.
- **The Update Framework (TUF)** — [theupdateframework/python-tuf](https://github.com/theupdateframework/python-tuf) ~1.7k ★ · Python · Apache-2.0 — the reference implementation of the spec that underpins Notary/Sigstore's root of trust. **Worth stealing:** TUF is *the* answer to **key compromise and rollback/freeze attacks** on a *distribution channel* — including the "**rug pull**" problem in a signed-channel form. If skills are distributed as an updatable index, TUF's roles (root/targets/snapshot/timestamp) and its **rollback, freeze, and mix-and-match attack** protections are the mature design; timestamp/snapshot metadata is what detects a malicious mirror serving stale-but-valid content.
- **in-toto/witness** — [repo](https://github.com/in-toto/witness) (the `testifysec/witness` repo has moved and now shows 0 ★) — attests each step of a pipeline and produces verifiable evidence; pairs with policy (OPA) so a release is gated on the *evidence*, not on the YAML.
- **OPA / conftest / Kyverno** — [open-policy-agent/opa](https://github.com/open-policy-agent/opa) ~12k ★ Apache-2.0; [conftest](https://github.com/open-policy-agent/conftest) ~3.3k ★; [kyverno](https://github.com/kyverno/kyverno) ~8.2k ★ Apache-2.0. **Policy-as-code with Rego over structured input.** Conftest's `--policy`, `--namespace`, `--output json|tap|table`, and deny/warn rules are the cleanest precedent for **"the scanner emits facts; a policy decides the verdict."** This is exactly what Cisco's CEL layer does, and it is the right architecture: **separate detection from policy** so an org can change its gate without changing the scanner.
- **OpenSSF Allstar** — [ossf/allstar](https://github.com/ossf/allstar) ~1.5k ★ · Go · Apache-2.0 — a GitHub App enforcing security policies on repos (**branch protection, outside collaborators, binary artifacts, security policy, token permissions**), with **enforce / dry-run / disabled** modes and per-policy `optConfig`. **Worth stealing:** the three-mode policy rollout (observe → alert → enforce) and the "action + fix PR" pattern — Allstar produces a *fix PR*, it does not just complain.
- **npm provenance** — [docs.npmjs.com/generating-provenance-statements](https://docs.npmjs.com/generating-provenance-statements) — `npm publish --provenance` creates a **signed SLSA v1 provenance attestation** (built on sigstore) binding the published tarball to the source repo + commit + build workflow, verifiable with `npm audit signatures`. **Worth stealing:** this is the *implemented* precedent for a package registry carrying provenance — copy the ergonomics (`--provenance` at publish, verified at install) rather than inventing a format.
- [slsa-framework/slsa](https://github.com/slsa-framework/slsa) ~1.9k ★; [sigstore/model-transparency](https://github.com/sigstore/model-transparency) for model signing (same idea applied to model artifacts).

---

## GROUP H — Scoring & triage models

### CVSS v3.1 / v4.0 — [v3.1 spec](https://www.first.org/cvss/v3.1/specification-document) · [v4.0 spec](https://www.first.org/cvss/v4-0/)
- **v3.1:** Base / Temporal / Environmental metric groups; Base = Exploitability (AV, AC, PR, UI) + Impact (C, I, A) with **Scope (S)** changing the formula branch.
- **v4.0:** four groups — **Base, Threat, Environmental, Supplemental**. Base **removes Scope and adds Attack Requirements (AT)**; replaces the formula with a **MacroVector** lookup. New **Supplemental** metrics: **Safety (S), Automatable (A), Recovery (R), Value Density (V), Vulnerability Response Effort (RE), Provider Urgency (U)**. Nomenclature: **CVSS-B** (Base), **CVSS-BT** (+Threat), **CVSS-BE** (+Environmental), **CVSS-BTE** (all) — *"NVD typically provides only the Base Scores enumerated as CVSS-B."* The **Threat** group is where "exploit maturity / active exploitation" lives, which is precisely the axis most scanners omit.
- **Qualitative severity scale (Table 22, applies to all nomenclatures):** None `0.0` · Low `0.1–3.9` · Medium `4.0–6.9` · High `7.0–8.9` · Critical `9.0–10.0`. Stated as **optional** — *"there is no requirement to include them."*
- **Worth stealing:** the **Supplemental metrics are a gift for a skill scanner.** *Automatable* (can an attacker automate this against every skill install?), *Recovery* (can the user recover after compromise?), *Value Density* (how valuable is what's reachable?), *Safety* (does failure risk physical harm?), and *Provider Urgency* map almost 1:1 onto skill risk. Adopting the CVSS 4.0 *vocabulary* for your severity justification gives you an industry-legible story without pretending your score is a CVE score.

### EPSS — [first.org/epss](https://www.first.org/epss/)
A data-driven model estimating **the probability a published CVE will be exploited in the wild in the next 30 days**, publishing a **0–1 probability plus a ranking percentile** daily for every CVE, via CSV and API. **Limitation to state plainly: EPSS is CVE-only and short-horizon** — it cannot score a prompt-injection pattern. But **dependency findings inside a skill can carry EPSS**, and the standard triage heuristic (`EPSS high AND CVSS high AND in CISA KEV ⇒ urgent`) is a defensible prioritization rule for the SCA slice of your findings ([KEV catalog](https://www.cisa.gov/known-exploited-vulnerabilities-catalog)).

### OWASP Risk Rating Methodology — [owasp.org](https://owasp.org/www-community/OWASP_Risk_Rating_Methodology)
**`Risk = Likelihood × Impact`**, with each factor estimated on **0–9** scales and then bucketed (the docs explicitly say *"it's best to err on the side of… identifying whether the likelihood is low, medium, or high"* rather than being over-precise), and warn that *"the risk rating is not the same as the CVSS score."*
- **Likelihood** — *Threat Agent* factors: Skill Level (1/3/5/6/9), Motive (1/4/9), Opportunity (0/4/7/9), Size (2/2/4/5/6/9). *Vulnerability* factors: Ease of Discovery (1/3/7/9), Ease of Exploit (1/3/5/9), Awareness (1/4/6/9), **Intrusion Detection (1/3/8/9)**.
- **Impact** — *Technical*: Loss of Confidentiality (2/6/6/7/9), Loss of Integrity (1/3/5/7/9), Loss of Availability, Loss of Accountability. *Business*: Financial damage, Reputation damage, Non-compliance, Privacy violation.
- **Worth stealing:** this is the **published, citable justification for a subjective-but-structured score**. If your score is an explicit weighted sum over named factors with published option values, it is defensible in a way that "we assigned HIGH" never is. Note the *Intrusion Detection* factor — a skill that disables logging/safety controls scores worse on **likelihood** too.

### Published aggregation formulas worth copying
1. **GuardDog Factor Rating (0–10):** documented in full in Group D. Note the properties that make it defensible: **all four weights sum to 1.0**, the components are computed from *dominant/max* values rather than counts (so it does not inflate with volume), and there are **two explicit caps** that encode policy ("low specificity can never look high risk"; "metadata alone can never be high_risk"). *Any* 0–100 score you ship should have this shape: weighted named factors + documented caps + a breakdown object in the output.
2. **OpenSSF Scorecard (0–10 per check):** per-check score, each check with a declared risk level, `-1` for unknown, and a **documented weighting in `checks.yaml`**; `--show-details` exposes the contribution of each check.
3. **SkillSpector (0–100):** additive `CRITICAL 50 / HIGH 25 / MEDIUM 10 / LOW 5`, `×1.3` executable-script multiplier, capped at 100, banded into 4 verdicts. **Simple, explainable, and legible** — but note the saturation problem: two CRITICALs hit 100, and 51+ (2 HIGHs) is already "DO NOT INSTALL," so it discriminates poorly at the top end. Also, additive models reward *volume* over *severity × confidence*.
4. **Mozilla Observatory / SSL Labs–style grades:** a letter grade plus per-category sub-scores. **Worth stealing:** a **grade (A–F) plus a small number of named sub-scores** communicates far better to a non-expert than a single 0–100, and it resists false precision. SkillSpector ships 4 bands; you could ship 6 grades × 4 category sub-scores.

### False-positive reduction — the consolidated toolkit
| Technique | Source |
|---|---|
| **Severity × confidence as two independent axes** | Bandit, gosec, Semgrep |
| **Capability × threat correlation within a scope** | GuardDog `can_form_risk` |
| **Specificity as a weighted factor + low-specificity score cap** | GuardDog |
| **Baseline file of accepted findings** | detect-secrets, Bandit, gitleaks, SkillSpector, SkillGuardrail |
| **Fingerprint-keyed ignore with drift tolerance** | gitleaks `.gitleaksignore`; SkillSpector glob rules + fingerprints |
| **Time-boxed suppressions (`expired_at`, `until=`)** | Trivy `.trivyignore.yaml`; Dependency-Check suppression XML |
| **Mandatory justification text on every suppression** | gitleaks/detect-secrets/Bandit `# nosec B301: reason`; Trivy `statement`; DefectDojo risk acceptance |
| **Never suppress high/critical** | SkillGuardrail baseline policy |
| **Auto-mark FP when a matching finding was previously triaged FP** | DefectDojo False Positive History |
| **Location-drift matching so renames/line shifts don't recreate findings** | DefectDojo |
| **Ignore "unfixed / not actionable"** | Trivy `--ignore-unfixed`, Grype `--only-fixed`, Dependency-Check `failOnCVSS` |
| **Reachability analysis** | Semgrep Supply Chain (`reachable` / `conditionally reachable` / `unreachable` / `no reachability analysis`) |
| **Diff-aware / changed-lines-only scanning** | Semgrep `--diff-aware`, `gitleaks protect --staged` |
| **Interactive audit that becomes a committed baseline** | detect-secrets audit |
| **Structured dismissal reasons + comment** | GitHub code scanning, DefectDojo |
| **Separate "policy" from "detection" so gates are tunable** | OPA/conftest, Cisco CEL shadow mode |
| **Report coverage gaps as findings** | Ramparts `ScanCoverageIncomplete`, SkillGuardrail `SG-LIMIT-003`/`SG-FILE-005` |
| **Disclose the scan mode (static vs full) in the result** | SkillSpector `llm_used` / `scan_mode` |
| **Suppression must be visible in the machine-readable output** | SkillSpector (SARIF external suppression + `suppressed_count`) |

---

## GROUP I — Report formats & UX best practices

### SARIF 2.1.0 — [OASIS spec](https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/sarif-v2.1.0-os.html)
The interchange format. Object model you must implement:
- `runs[]` → `tool.driver.{name, version, informationUri, rules[]}`, `invocations[]`, `taxonomies[]`, `results[]`.
- **Rule descriptor:** `id`, `name`, `shortDescription`, `fullDescription`, `help` (markdown) + `helpUri`, `defaultConfiguration.level`, `properties` (a free bag — this is where `tags`, `precision`, and GitHub's `security-severity` live), `relationships` (e.g. `superset`/`subset` to map your rule to a CWE).
- **Result:** `ruleId`, `ruleIndex`, `level` (`none|note|warning|error`), `message`, `locations[].physicalLocation.{artifactLocation.uri, region.{startLine,startColumn,endLine,endColumn,snippet}}`, `relatedLocations[]`, **`codeFlows[]`/`threadFlows[]`** (the dataflow trace — mandatory if you do taint analysis; it is what makes a finding verifiable), **`fixes[]`** (remediation with a replacement artifact — the machine-readable "what to do next"), `suppressions[]` (with `kind`: `inSource`/`external`, `status`, `justification`), **`fingerprints`** + **`partialFingerprints`** (cross-run identity), `baselines`, `properties`.
- **Taxonomies:** `run.taxonomies[]` with `taxa[]`, and results reference them via `result.taxa[]`/`rule.relationships` — this is the *standard* place to put your CWE/OWASP-LLM/ATLAS mappings instead of stuffing them into strings.
- **GitHub's additions and hard limits** ([docs](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning)):
  - `properties.security-severity` — a string float >0.0–10.0; including it marks results as *security* results. **Buckets: >9.0 critical · 7.0–8.9 high · 4.0–6.9 medium · 0.1–3.9 low · 0.0 or out-of-range = no security severity.** Displayed results are ordered by `security-severity` then `precision`.
  - `properties.precision` (`very-high|high|medium|low`).
  - `defaultConfiguration.level` ∈ `note|warning|error`; overridable per-result via `level`.
  - **Max 10 MB gzipped per SARIF file; max 25,000 entries** for the limited object types; exceeding either rejects the whole file.
  - Dedup across runs uses **`partialFingerprints`**; if absent, GitHub tries to populate it (the `upload-sarif` action's `fingerprints.ts` is the reference implementation). Without fingerprints, users see duplicates.
- **Worth stealing:** emit SARIF as a first-class citizen (SkillSpector, Cisco, Ramparts, SkillGuardrail, GuardDog, Trivy, Grype, Semgrep, njsscan all do). Put taxonomies in `taxonomies`, dataflow in `codeFlows`, remediation in `fixes`, and suppressions in `suppressions` — then you get GitHub/IDE/DefectDojo integration for free.

### CycloneDX VEX — [cyclonedx.org/capabilities/vex](https://cyclonedx.org/capabilities/vex/)
`vulnerabilities[]` with `analysis.state` ∈ `resolved | resolved_with_pedigree | exploitable | in_triage | false_positive | not_affected` and `analysis.justification` ∈ `code_not_present | code_not_reachable | requires_configuration | requires_dependency | requires_environment | protected_by_compiler | protected_at_runtime | protected_at_perimeter | protected_by_mitigating_control`, plus `analysis.detail` (free text), `response[]`, and `firstIssued`/`lastUpdated`. **This is the standards-track way to publish "not applicable, and here is why"** — far more valuable to a customer than a private ignore file. SPDX for licence-centric SBOMs ([spec](https://spdx.github.io/spdx-spec/v2.3/)).

### Dashboard UX — the good, the bad, the portable
**Good patterns observed**
1. **Group by rule as the default view, sorted by severity, then by finding count** (Semgrep). A flat list of 400 findings is unusable; "1 rule, 400 instances" is actionable.
2. **Structured dismissal with a mandatory reason + comment** (GitHub). Makes triage auditable and enables FP-history automation.
3. **Persistent finding identity across runs** (fingerprints/partialFingerprints/`hash_code`) so triage state survives code changes and only *new* things demand attention.
4. **The "diff" view is the primary view in CI** — `reimport`/baseline/branch-diff semantics. "What changed in this PR" beats "what is wrong with this repo."
5. **Severity + confidence + reachability as three visible filters** (Semgrep, Trivy `Status`) rather than one collapsed severity.
6. **Remediation inline.** Grype's `FIXED-IN` column; SARIF `fixes[]`; Semgrep autofix; Allstar's fix-PR. **"What do I do next" must be a field, not a link to docs.**
7. **Negative assurance is a feature.** njsscan's `--missing-controls`, Ramparts' `ScanCoverageIncomplete`, SkillSpector's `llm_used`/`scan_mode`. Saying *what you did not check* is what makes the rest trustworthy.
8. **A per-tool tree with pass/fail marks** (mcp-shield) — the most legible terminal output seen; scales down to a single skill with 12 checks.
9. **Findings as API objects** (trivy-operator CRDs), not files — enables live drift views.
10. **Aggregation with normalization** (DefectDojo): one canonical Finding model, many scanners, dedup across tools.
11. **Grade + sub-scores for non-experts** (Observatory/SSL Labs style) — resists false precision.
12. **Consent and safety as UI** (Snyk: per-server consent prompt showing the exact command/URL; SkillSpector: HTTP mode refuses `file://`).

**Bad patterns / traps**
1. **A single severity number with no confidence or reachability** — the root cause of alert fatigue.
2. **Additive scores that saturate** (SkillSpector: two CRITICALs = 100; 51 already = "DO NOT INSTALL").
3. **Exit codes that don't map 1:1 onto verdicts** (SkillSpector collapses SAFE and CAUTION into `0`, forcing JSON parsing).
4. **Trusting a tool's own fingerprints blindly** — DefectDojo had to stop trusting fingerprints that repeat within one SARIF report, because unrelated findings were being merged.
5. **Silent truncation** (Skill Spectre's competitors call this out explicitly; SkillWard markets "no truncation limits"). If you truncate, **say so as a finding**.
6. **Unbounded ingest** — a marketplace scanner will be handed zip bombs and 10 GB repos. Cap and fail closed.
7. **Echoing secrets or terminal control characters into reports** (SkillGuardrail redacts and escapes; gitleaks has `--redact`).
8. **"0 findings" presented as "safe."** Both Cisco (`No findings ≠ no risk`) and SkillGuardrail (`PASS is not a safety certificate`) ship explicit disclaimers. Copy that language.

---

## GROUP J — Regulatory / compliance mappings

### OWASP Top 10 for LLM Applications 2025 — [genai.owasp.org/llm-top-10](https://genai.owasp.org/llm-top-10/)
| ID | Title |
|---|---|
| LLM01:2025 | Prompt Injection |
| LLM02:2025 | Sensitive Information Disclosure |
| LLM03:2025 | Supply Chain |
| LLM04:2025 | Data and Model Poisoning |
| LLM05:2025 | Improper Output Handling |
| LLM06:2025 | Excessive Agency |
| LLM07:2025 | System Prompt Leakage |
| LLM08:2025 | Vector and Embedding Weaknesses |
| LLM09:2025 | Misinformation |
| LLM10:2025 | Unbounded Consumption |

Notably, SkillSpector's 17 categories map onto this list almost one-to-one (LLM01→P1–P4, LLM02/LLM07→P6–P8, LLM03→SC*, LLM05→OH*, LLM06→EA*, LLM10→EA4/OH3, plus additions for anti-refusal, memory poisoning, rogue agent, and trigger abuse). **Also published (2026):** an "OWASP GenAI LLM Top 10 2026" and an "**Agent Control Standard (ACS)**" resource, per [genai.owasp.org](https://genai.owasp.org/) — verify the current edition before hard-coding IDs.

### OWASP Top 10 for Agentic Applications for 2026 — [resource page](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)
Published **9 December 2025**, peer-reviewed with 100+ contributors; the page is a PDF download and does **not** enumerate the item IDs in HTML, so the `ASI01`–`ASI10` identifiers could not be verified from the primary HTML source in this session (**treat ASI IDs as unverified until read from the PDF**).

**What *is* verifiable is the skill-specific taxonomy that Ramparts ships: "OWASP Agentic Skills Top 10", URN `owasp-agentic-skills-top-10:2026:ASTxx`** ([security-features.md](https://github.com/highflame-ai/ramparts/blob/main/docs/security-features.md)):

| ID | Title | Detectors mapped by Ramparts |
|---|---|---|
| AST01 | Malicious Skills | `PromptInjectionSignature`, `CovertExfiltration`, `SkillCredentialHarvesting`, `SkillSystemManipulation`, malware/webshell/cryptominer IOCs, `AgentIdentityFileWrite` |
| AST02 | Supply Chain Compromise | `VulnerableDependency`, `UndeclaredNetworkEgress` |
| AST03 | Over-Privileged Skills | `OverbroadAllowedTools`, `DataExfiltrationGrant`, `AutonomyAbuse`, `SkillSensitiveFileReference`, `AgentIdentityFileWrite` |
| AST04 | Insecure Metadata | agentskills validation, `CapabilityInflation`, `VagueSkillTrigger`, `GenericSkillTrigger`, `UnsafeYamlDeserialization`, `BrandImpersonation`, `JsonPrototypePollution` |
| AST05 | Untrusted External Instructions | `IndirectPromptInjection`, `ExternalReferenceInventory` |
| AST06 | Weak Isolation | `SkillNameCollision` (router shadowing) |
| AST07 | Update Drift | `SkillContentChanged` (rug pull) |
| AST08 | Poor Scanning | `ScanCoverageIncomplete` |
| AST09 / AST10 | (runtime / governance — not enumerated by Ramparts) | — |

**⚠️ Accuracy warning worth acting on:** Ramparts tags findings with `owasp-mcp-top-10:2025-draft:MCP05` etc. using a mapping in which `MCP01 = Prompt Injection`, `MCP02 = Tool Poisoning`, `MCP03 = Excessive Agency`, `MCP04 = Insecure Tool Output Handling`, `MCP05 = Cross-Origin Tool Confusion`, `MCP06 = Credential and Secret Leakage`, `MCP07 = Command and SQL Injection`, `MCP08 = Auth Bypass`, `MCP09 = Sensitive Data Exposure`, `MCP10 = Supply Chain`. **That is not the official OWASP MCP Top 10.** The official list ([OWASP/www-project-mcp-top-10](https://github.com/OWASP/www-project-mcp-top-10)) is:

| ID | Title |
|---|---|
| MCP01:2025 | Token Mismanagement & Secret Exposure |
| MCP02:2025 | Privilege Escalation via Scope Creep |
| MCP03:2025 | Tool Poisoning |
| MCP04:2025 | Software Supply Chain Attacks & Dependency Tampering |
| MCP05:2025 | Command Injection & Execution |
| MCP06:2025 | Prompt Injection via Contextual Payloads |
| MCP07:2025 | Insufficient Authentication & Authorization |
| MCP08:2025 | Lack of Audit and Telemetry |
| MCP09:2025 | Shadow MCP Servers |
| MCP10:2025 | Context Injection & Over-Sharing |

Ramparts labels its mapping `-draft`, which is honest — but it means **a competitor is shipping a visibly wrong taxonomy mapping.** Getting this right, citing the official version, and versioning the mapping URN (`owasp-mcp-top-10:2025:MCP03`) is free credibility.

### MITRE ATLAS — [atlas.mitre.org](https://atlas.mitre.org/) · data: [mitre-atlas/atlas-data](https://github.com/mitre-atlas/atlas-data)
Verified against `dist/ATLAS.yaml`, **ATLAS v5.6.0**: 16 tactics, **170 techniques**, 35 mitigations. Tactics: `AML.TA0002` Reconnaissance, `AML.TA0003` Resource Development, `AML.TA0004` Initial Access, `AML.TA0000` AI Model Access, `AML.TA0005` Execution, `AML.TA0006` Persistence, `AML.TA0012` Privilege Escalation, `AML.TA0007` Defense Evasion, `AML.TA0013` Credential Access, `AML.TA0008` Discovery, `AML.TA0015` Lateral Movement, `AML.TA0009` Collection, `AML.TA0001` AI Attack Staging, `AML.TA0014` Command and Control, `AML.TA0010` Exfiltration, `AML.TA0011` Impact.

**The ~30 ATLAS techniques a skill scanner should map to (IDs verified):**

| ID | Name | Tactic |
|---|---|---|
| AML.T0010 | AI Supply Chain Compromise | Initial Access |
| AML.T0010.001 | AI Software | — |
| AML.T0010.005 | **AI Agent Tool** | — |
| AML.T0011 | User Execution *(ATT&CK T1204)* | Execution |
| AML.T0011.001 | Malicious Package | — |
| AML.T0011.002 | Poisoned AI Agent Tool | — |
| AML.T0050 | Command and Scripting Interpreter *(T1059)* | Execution |
| AML.T0051 | **LLM Prompt Injection** | Execution |
| AML.T0051.000 / .001 / .002 | **Direct / Indirect / Triggered** | — |
| AML.T0054 | LLM Jailbreak | Priv-Esc, Defense Evasion |
| AML.T0055 | Unsecured Credentials *(T1552)* | Credential Access |
| AML.T0056 | Extract LLM System Prompt | Exfiltration |
| AML.T0057 | LLM Data Leakage | Exfiltration |
| AML.T0065 | LLM Prompt Crafting | Resource Development |
| AML.T0066 | Retrieval Content Crafting | Resource Development |
| AML.T0067 | LLM Trusted Output Components Manipulation | Defense Evasion |
| AML.T0068 | **LLM Prompt Obfuscation** | Defense Evasion |
| AML.T0069 | Discover LLM System Information (`.000` Special Character Sets, `.001` System Instruction Keywords, `.002` System Prompt) | Discovery |
| AML.T0070 | RAG Poisoning | Persistence |
| AML.T0079 | Stage Capabilities *(T1608)* | Resource Development |
| AML.T0080 | **AI Agent Context Poisoning** (`.000` Memory, `.001` Thread) | Persistence |
| AML.T0083 | **Credentials from AI Agent Configuration** | Credential Access |
| AML.T0084 | Discover AI Agent Configuration (`.000` Embedded Knowledge, `.001` **Tool Definitions**, `.002` Activation Triggers, `.003` Call Chains) | Discovery |
| AML.T0085 | Data from AI Services (`.001` AI Agent Tools) | Collection |
| AML.T0086 | **Exfiltration via AI Agent Tool Invocation** | Exfiltration |
| AML.T0090 | OS Credential Dumping *(T1003)* | Credential Access |
| AML.T0092 | Manipulate User LLM Chat History | Defense Evasion |
| AML.T0094 | **Delay Execution of LLM Instructions** | Defense Evasion |
| AML.T0098 | AI Agent Tool Credential Harvesting | Credential Access |
| AML.T0099 | AI Agent Tool Data Poisoning | Persistence |
| AML.T0101 | Data Destruction via AI Agent Tool Invocation | Impact |
| AML.T0102 | Generate Malicious Commands | AI Attack Staging |
| AML.T0104 | Publish Poisoned AI Agent Tool | Resource Development |
| AML.T0109 | **AI Supply Chain Rug Pull** | Defense Evasion |
| AML.T0110 | **AI Agent Tool Poisoning** | Persistence |
| AML.T0111 | AI Supply Chain Reputation Inflation | Defense Evasion |

**This is the strongest single mapping for a skill scanner** — it has explicit entries for tool poisoning, agent tool credential harvesting, agent configuration credential access, context poisoning, delayed execution, and rug pull. It also gives you **free ATT&CK cross-references** (`AML.T0055`→`T1552`, `AML.T0090`→`T1003`, `AML.T0050`→`T1059`, `AML.T0079`→`T1608`, `AML.T0011`→`T1204`) so one mapping yields two frameworks.

### MITRE ATT&CK — [attack.mitre.org/tactics/enterprise](https://attack.mitre.org/tactics/enterprise/)
14 enterprise tactics: `TA0043` Reconnaissance, `TA0042` Resource Development, `TA0001` Initial Access, `TA0002` Execution, `TA0003` Persistence, `TA0004` Privilege Escalation, `TA0005` Defense Evasion, `TA0006` Credential Access, `TA0007` Discovery, `TA0008` Lateral Movement, `TA0009` Collection, `TA0011` Command and Control, `TA0010` Exfiltration, `TA0040` Impact.
**Script-level techniques to map:** `T1059` Command and Scripting Interpreter (`.001` PowerShell, `.003` Windows Command Shell, `.004` Unix Shell, `.005` Visual Basic, `.006` Python, `.007` JavaScript, `.011` Node.js); `T1204` User Execution; `T1546.004` Unix Shell Configuration Modification; `T1543` Create or Modify System Process; `T1547` Boot or Logon Autostart Execution; `T1053` Scheduled Task/Job (`.003` Cron, `.005` Scheduled Task); `T1548` Abuse Elevation Control (`.003` Sudo); `T1552` Unsecured Credentials (`.001` Credentials In Files, `.004` Private Keys); `T1555` Credentials from Password Stores; `T1041` Exfiltration Over C2 Channel; `T1567` Exfiltration Over Web Service (`.002` Exfiltration to Cloud Storage); `T1071` Application Layer Protocol; `T1105` Ingress Tool Transfer; `T1027` Obfuscated Files or Information (`.002` Software Packing, `.003` Steganography, `.006` HTML Smuggling, `.010` Command Obfuscation, `.013` Encrypted/Encoded File); `T1140` Deobfuscate/Decode Files or Information; `T1195` Supply Chain Compromise (`.001`/`.002`); `T1113` Screen Capture; `T1056.001` Keylogging; `T1115` Clipboard Data; `T1496` Resource Hijacking (cryptomining).

### NIST AI RMF — [AI 100-1](https://doi.org/10.6028/NIST.AI.100-1) · [NIST page](https://www.nist.gov/itl/ai-risk-management-framework)
Four functions: **GOVERN, MAP, MEASURE, MANAGE**. Subcategories most relevant to a scanner's output: **GV.1.x** (policies, roles, training), **GV.2.x** (accountability), **GV.3.x** (workforce), **GV.4.x** (third-party/supply-chain risk), **GV.6.x** (third-party software and data), **MP.1–MP.5** (context, categorization, capabilities, risks), **MS.2.6** (AI system security and resilience evaluated), **MS.2.7** (security and resilience **documented**), **MS.2.13** (risk measurement results documented), **MS.4.1–MS.4.3** (feedback, improvement), **MG.1–MG.4** (treatment, monitoring, response). The **NIST AI 600-1 Generative AI Profile** enumerates 12 GAI risks (including *Information Integrity*, *Information Security*, *Confabulation*, *Data Privacy*, *Harmful Bias*, *Human-AI Configuration*, *Intellectual Property*, *Obscene/Degrading/Abusive Content*, *CBRN*, *Value Chain and Component Integration*, *Dangerous/Violent/Hateful Content*, *Environmental*). **Worth stealing:** `GV.4`/`GV.6` and `MS.2.6`/`MS.2.7` are the exact hooks for "we scan third-party skills and document the results" — a scanner report is *evidence* for MS.2.7. Check nist.gov for 2025–2026 revisions before citing versions.

### EU AI Act — [Art. 15](https://artificialintelligenceact.eu/article/15/) · [implementation timeline](https://artificialintelligenceact.eu/implementation-timeline/)
- **Art. 9** risk management system; **Art. 10** data governance; **Art. 13** transparency/instructions for use; **Art. 14** human oversight; **Art. 15** accuracy, robustness and cybersecurity; **Art. 16–27** provider/deployer/importer obligations; **Art. 50** transparency obligations; **Art. 72** post-market monitoring; **Art. 73** serious-incident reporting; **Art. 51–56** GPAI obligations (with a Code of Practice).
- **Art. 15(5) verbatim (the cybersecurity paragraph — quote it in your compliance docs):**
  > *"High-risk AI systems shall be resilient against attempts by unauthorised third parties to alter their use, outputs or performance by exploiting system vulnerabilities. The technical solutions aiming to ensure the cybersecurity of high-risk AI systems shall be appropriate to the relevant circumstances and the risks. The technical solutions to address AI specific vulnerabilities shall include, where appropriate, measures to prevent, detect, respond to, resolve and control for attacks trying to manipulate the training data set (data poisoning), or pre-trained components used in training (model poisoning), inputs designed to cause the AI model to make a mistake (adversarial examples or model evasion), confidentiality attacks or model flaws."*
  Also Art. 15(1)–(4): appropriate accuracy/robustness/cybersecurity across the lifecycle; Commission to encourage **benchmarks and measurement methodologies**; accuracy levels **declared in the instructions of use**; resilience to errors/faults from interaction with persons or other systems; robustness via technical redundancy and fail-safe plans.
- **Phase-in (verify against the official timeline/EUR-Lex before publishing):** entry into force 1 Aug 2024; prohibitions 2 Feb 2025; GPAI obligations 2 Aug 2025; high-risk 2 Aug 2026 (with some Art. 6(1) systems to 2 Aug 2027).
- **Worth stealing:** Art. 15(5)'s list (data poisoning, model poisoning, adversarial examples/model evasion, confidentiality attacks, model flaws) is a ready-made *risk-category vocabulary* for an EU-market product, and Art. 15(3)'s "declare your accuracy metrics in the instructions of use" is the regulatory argument for **publishing your benchmark numbers** (which Cisco does and no one else does well).

### CWE mapping — [cwe.mitre.org](https://cwe.mitre.org/)
Structure: `CWE-NNN` with Abstraction (Pillar/Class/Base/Variant), Status, and relationships (`ChildOf`, `PeerOf`, `CanPrecede`). **[CWE-1426: Improper Validation of Generative AI Output](https://cwe.mitre.org/data/definitions/1426.html) is real** (verified — a Base weakness, "Improper Validation of Generative AI Output"). CWE Top 25 (2025) order: `CWE-79, 89, 352, 862, 787, 22, 416, 125, 78, 94, 120, 434, 476, 121, 502, 122, 863, 20, 284, 200, 306, 918, 77, 639, 770`.
**CWEs to map for a skill scanner:** `CWE-78` OS Command Injection · `CWE-77` Command Injection · `CWE-94` Code Injection · `CWE-95` Eval Injection · `CWE-502` Deserialization of Untrusted Data · `CWE-798` Use of Hard-coded Credentials · `CWE-312` Cleartext Storage of Sensitive Information · `CWE-319` Cleartext Transmission · `CWE-200` Exposure of Sensitive Information · `CWE-22` Path Traversal · `CWE-23` Relative Path Traversal · `CWE-59` Link Following · `CWE-732` Incorrect Permission Assignment · `CWE-276` Incorrect Default Permissions · `CWE-250` Execution with Unnecessary Privileges · `CWE-269` Improper Privilege Management · `CWE-829` Inclusion of Functionality from Untrusted Control Sphere · `CWE-494` Download of Code Without Integrity Check · `CWE-506` Embedded Malicious Code · `CWE-507` Trojan Horse · `CWE-511` Logic/Time Bomb · `CWE-512` Spyware · `CWE-1336` Server-Side Template Injection · `CWE-918` SSRF · `CWE-601` Open Redirect · `CWE-611` XXE · `CWE-1333` ReDoS · `CWE-117` Log Injection · `CWE-1426` Improper Validation of Generative AI Output. *(Verify any AI-specific CWEs — e.g. a prompt-injection CWE — against cwe.mitre.org before shipping; CWE-1426 is confirmed, other AI entries were not verified here.)*

### Adjacent AI-security standards to check for 2026
- **Cloud Security Alliance MAESTRO** — a threat-modelling framework for agentic AI (7 layers: business/workflow, agent, model, data, infrastructure, security/compliance, ecosystem). Cite [cloudsecurityalliance.org](https://cloudsecurityalliance.org/).
- **ISO/IEC 42001** — AI management system standard (certifiable); the natural "management-system" counterpart to NIST AI RMF. Cite [iso.org](https://www.iso.org/standard/81230.html).
- **OpenSSF** — [openssf.org](https://openssf.org/); model signing via [sigstore/model-transparency](https://github.com/sigstore/model-transparency); SLSA for build integrity.

---

# DELIVERABLE 1 — Top 15 ranked for a *skill* static scanner

Ranked by (relevance to skill scanning) × (quality of ideas) × (adoptability). Stars as of 2026-09-30.

| # | Project | Stars | Lang / License | Why it ranks | **What to adopt** |
|---|---|---|---|---|---|
| 1 | [NVIDIA/SkillSpector](https://github.com/NVIDIA/SkillSpector) | 19k | Py / Apache-2.0 | The category's reference implementation; same problem statement, published pattern set, real pipeline | Its **71-pattern / 17-category taxonomy** as a coverage checklist; taint patterns TT1–TT5; **exit-code + JSON + SARIF contract**; **fingerprint + glob baselines with SARIF external suppressions**; `confidence` as a float per finding; `llm_used`/`scan_mode` honesty fields; `recommendation` + `safe_to_install` as first-class verdicts; MCP-server mode as an install gate |
| 2 | [highflame-ai/ramparts](https://github.com/highflame-ai/ramparts) | 97 | Rust / Apache-2.0 | **Closest functional match**; the best per-detector detail of any project surveyed | **Normalized + iteratively base64/hex-decoded rescan** (zero-width strip, NFKC homoglyph fold); `ScanCoverageIncomplete` as a finding; `UndeclaredNetworkEgress` (manifest vs script); `AgentIdentityFileWrite`; `SkillSensitiveFileReference` for `@<path>`; `SkillNameCollision`; `AgentskillsNameMismatch`; `UnsafeYamlDeserialization`; `JsonPrototypePollution`; `BrandImpersonation`; `SkillContentChanged` drift; OWASP AST tagging in all renderers |
| 3 | [DataDog/guarddog](https://github.com/DataDog/guarddog) | 1.2k | Py / Apache-2.0 | **The best-documented scoring architecture in existence for this problem shape** | The whole **capability × threat → risk** correlation model with category + detail compatibility; the **Factor Rating formula** (severity .30 / chain .20 / specificity .30 / sophistication .20); the **4.9 and 6.9 caps**; **specificity as a first-class weighted field**; ATT&CK-phase chain completeness; capability/threat YARA rule naming; the in-repo rule-authoring skill |
| 4 | [cisco-ai-defense/skill-scanner](https://github.com/cisco-ai-defense/skill-scanner) | 2.6k | Py / Apache-2.0 | Most rigorous methodology; **separates detection from policy** | **Benchmark-first development** with named corpora (MaliciousSkillBench, NotInject hard negatives, HarmfulSkillBench, OpenSkillRisk) and **in-distribution + source-disjoint reporting including failed gates**; the **CEL decision layer over typed detector facts** (detection ≠ policy); YARA-X + AST + dataflow layering; plugin architecture; pre-commit + GitHub Actions distribution; explicit scope/limitations section |
| 5 | [T-Zevin/SkillGuardrail](https://github.com/T-Zevin/SkillGuardrail) | 57 | Go / Apache-2.0 | **Best product/lifecycle design**; best suppression safety model | **Quarantine → scan → verdict → approve → atomic install → verify**; **source commit + fingerprint + receipt** binding; `verify` drift detection; **"baselines may never suppress high/critical"**; verdicts instead of a score; **fail-closed limits that refuse to emit a fingerprint**; a **namespaced stable rule-ID catalog** (`SG-*`) as a shipped doc; `SG-CHAIN-002`'s deliberate conservatism against cross-file co-occurrence FPs; archive pre-flight rejection (traversal/absolute/case-folding collisions/zip-bomb ratio) |
| 6 | [VirusTotal/yara-x](https://github.com/VirusTotal/yara-x) + [yara](https://github.com/VirusTotal/yara) | 1.3k / 9.9k | Rust·C / BSD-3 | The right engine for content-level malware IOCs in bundled scripts; every serious competitor uses it | **YARA-X as the signature engine**; capability vs threat rule namespacing (from GuardDog); ingest **YARA-Forge / signature-base** third-party packs instead of writing all rules; `math.entropy()` for packed/encrypted blobs; `base64`/`xor`/`wide` modifiers which do the decode-normalization work for you |
| 7 | [aquasecurity/trivy](https://github.com/aquasecurity/trivy) | 38k | Go / Apache-2.0 | Best-in-class filtering/suppression UX and the widest format support | **`.trivyignore.yaml` with `expired_at` + `statement` + `paths`/`purls`**; `Status` as a field (affected/fixed/will_not_fix/EOL); `--ignore-unfixed` semantics; `--severity` gate; multi-format output incl. SARIF/CycloneDX/SPDX; **`trivy-operator` CRD model = findings as API objects** |
| 8 | [DefectDojo/django-DefectDojo](https://github.com/DefectDojo/django-DefectDojo) | 5k | Py / BSD-3 | The mature aggregation/triage model to copy for the dashboard | **False Positive History** (auto-FP on a matching previously-triaged finding); **Location Drift Matching**; configurable **`hash_code` fields with always-included fields**; per-parser dedup algorithm; **reimport closes absent findings**; **risk acceptance with expiry**; **SLA per severity**; **do NOT trust fingerprints that repeat within one report** |
| 9 | [ast-grep/ast-grep](https://github.com/ast-grep/ast-grep) | 16k | Rust / MIT | The most permissive, most reusable multi-language structural engine | Use it (or tree-sitter directly) for **Python/Bash/JS/TS/PowerShell/Ruby structural rules with one rule DSL**; `kind`/`inside`/`has`/`not`/`matches` composition mirrors Semgrep's ergonomics; `fix` blocks give you machine-readable remediation; MIT licence removes all legal friction |
| 10 | [semgrep/semgrep](https://github.com/semgrep/semgrep) | 17k | C / LGPL-2.1 | The rule-authoring and triage UX gold standard | **`mode: taint`** with sources/sinks/sanitizers/propagators to model SKILL.md-instruction → tool-call flows; the **severity × confidence × impact** triple; **group-by-rule default view**; triage states Open/Reviewing/Ignored/Fixed; `# nosemgrep` inline suppression; **`--diff-aware`** PR-scoped scanning; rule registry as a distribution channel |
| 11 | [gitleaks/gitleaks](https://github.com/gitleaks/gitleaks) | 30k | Go / MIT | Best secret-detection ergonomics; directly needed for skill secrets | **Regex × entropy × keywords as three signals** (not regex alone); **`stopwords`** (critical for prose-heavy SKILL.md); `--redact` as a default; **`.gitleaksignore` fingerprint keys**; global + per-rule allowlists; `protect --staged` pre-commit ergonomics |
| 12 | [ossf/scorecard](https://github.com/ossf/scorecard) | 5.7k | Go / Apache-2.0 | Adds the **repository/source-trust dimension** nothing else covers | The **20-check list with per-check documented risk levels** (esp. `Dangerous-Workflow`, `Token-Permissions`, `Signed-Releases`, `Binary-Artifacts`, `Branch-Protection`, `Code-Review`) as a **source-repo trust sub-score**; **`-1` for unknown, excluded from the aggregate**; per-check rationale shipped as data (`checks.yaml`) |
| 13 | [Yelp/detect-secrets](https://github.com/Yelp/detect-secrets) | 4.6k | Py / Apache-2.0 | The **best FP-suppression workflow**: interactive audit → committed baseline | The **audit-and-commit-baseline loop** (human triage becomes permanent reviewable state); plugin architecture with `secret_type` + denylist; baseline file as the CI-incremental primitive |
| 14 | [trailofbits/fickling](https://github.com/trailofbits/fickling) + [protectai/modelscan](https://github.com/protectai/modelscan) | 670 / 777 | Py / LGPL-3.0 · Apache-2.0 | The **deobfuscation / deserialization** capability nobody in the skill space has | Fickling's **pickle disassembly to readable pseudo-Python** + dangerous-opcode denylist — apply the same "decode and show the human" principle to base64/hex blobs in skills; modelscan's **unsafe-operator denylist** pattern for `pickle`/`torch.load`/`joblib`/`yaml.load`/`marshal` |
| 15 | [open-policy-agent/opa](https://github.com/open-policy-agent/opa) + [conftest](https://github.com/open-policy-agent/conftest) | 12k / 3.3k | Go / Apache-2.0 | The correct **detection/policy separation** and the enterprise gate story | **Emit facts; let Rego/CEL decide the verdict** — orgs change gates without a scanner release; conftest's `--policy`/`--namespace`/`--output`/deny-warn model; pair with [sigstore/cosign](https://github.com/sigstore/cosign) (keyless signing + Rekor) and [SLSA](https://slsa.dev/spec/v1.0/levels) provenance for the "signed, verified, published" endgame |

**Honourable mentions:** [Tencent/AI-Infra-Guard](https://github.com/Tencent/AI-Infra-Guard) (6.6k — platform packaging, marketplace distribution via ClawHub), [snyk/agent-scan](https://github.com/snyk/agent-scan) (3.1k — SSRF hardening, consent UX, discovery), [invariantlabs-ai/mcp-scan](https://github.com/invariantlabs-ai/mcp-scan) (3.1k — static scan + runtime proxy arc, toxic flows), [Fangcun-AI/SkillWard](https://github.com/Fangcun-AI/SkillWard) (142 — Docker sandbox dynamic verification), [riseandignite/mcp-shield](https://github.com/riseandignite/mcp-shield) (555 — `--identify-as`, tree output), [alexgreensh/repo-forensics](https://github.com/alexgreensh/repo-forensics) (183 — Ed25519-signed rule feed, zero-dep posture), [Pantheon-Security/medusa](https://github.com/Pantheon-Security/medusa) (1.0k — chat/shell-history secrets, interactive redaction), [cisco-ai-defense/mcp-scanner](https://github.com/cisco-ai-defense/mcp-scanner) (1.1k — readiness scanning, VirusTotal, sandboxed PyPI analysis).

---

# DELIVERABLE 2 — 70 detection rules / capabilities we likely lack

Each row names the capability, the concrete signal, and the project to copy. Grouped by theme.

### A. Encoding, obfuscation & anti-evasion (highest value — cheap and high-signal)
1. **Zero-width / invisible character detection** — U+200B–U+200D, U+2060, U+FEFF, U+00AD; render as `[U+200B]` in output. *(Ramparts `UnicodeSteganography`; llm-guard `InvisibleText`; SkillGuardrail `SG-OBF-004`)*
2. **Unicode Tag block smuggling** — U+E0000–U+E007F (invisible ASCII-smuggling channel; a known LLM prompt-injection vector). *(Ramparts hidden-instruction class; SkillSpector TP1)*
3. **Homoglyph / confusable detection with NFKC folding** — Cyrillic/Greek/fullwidth lookalikes in commands, package names, and skill names; compare normalized vs raw. *(Ramparts evasion-resistant rescan; GuardDog `threat-runtime-obfuscation-unicode`)*
4. **Bidirectional / RTL-override detection** — U+202A–U+202E, U+2066–U+2069 (Trojan Source class). *(SkillSpector TP2; SkillGuardrail `SG-OBF-004`)*
5. **ANSI escape sequence injection** — CSI/OSC sequences in output that can rewrite a terminal or hide text from a reviewer. *(SkillGuardrail escapes terminal control characters in evidence)*
6. **Base64/hex blob detection by length + entropy** — ≥500-char blobs, excluding legitimate `data:image/...;base64,`. *(Ramparts `SkillEmbeddedPayload`; SkillSpector SC3)*
7. **Iterative decode-and-rescan** — decode base64/hex recursively (bounded depth) and re-run all rules over decoded views. *(Ramparts — its single best feature; gitleaks `--max-decode-depth`)*
8. **Normalized-view rescan** — strip zero-width + NFKC-fold, then re-run every rule. *(Ramparts)*
9. **Entropy-based packed/encrypted content detection** — Shannon entropy over file/segment bytes; `math.entropy()` in YARA. *(YARA `math` module; gitleaks entropy rules)*
10. **Reflective/indirect execution detection** — `getattr(os,'system')`, `getattr(builtins,'exec')`, `__import__`, `globals()[...]()`, `Function`/`setTimeout(string)` — the anti-evasion rules that catch what direct `exec`/`eval` rules miss. *(SkillSpector AST9, AST3)*
11. **Multi-language obfuscation signatures** — PowerShell `-enc`/`-EncodedCommand`, `IEX`, `FromBase64String`, `chr()` chains, JS string mangling, PyArmor. *(GuardDog `threat-process-powershell-encoded`, `threat-runtime-obfuscation-chr`, `-js-mangling`, `-pyarmor`)*
12. **Deobfuscation with human-readable output** — disassemble a pickle / decode a blob and *show the reviewer what it does*. *(fickling)*
13. **Steganography indicators** — appended data after image/document EOF, LSB anomalies, oversized "images". *(GuardDog `threat-runtime-obfuscation-steganography`; SkillSpector SC9)*

### B. Payload & deserialization
14. **Pickle / marshal / dill / joblib unsafe-opcode detection** — `GLOBAL`/`REDUCE`/`STACK_GLOBAL` reachable to `os.system`, `subprocess`, `eval`. *(modelscan, fickling, Bandit B301/B302/B403)*
15. **`yaml.load` without `SafeLoader`** and YAML tags in SKILL.md frontmatter: `!!python/object`, `!!python/apply`, `!ruby/object`, `!!java`, `!!binary`. *(Ramparts `UnsafeYamlDeserialization`; Bandit B506)*
16. **JSON prototype pollution** — `__proto__` / `constructor` / `prototype` keys in bundled `package.json`/`manifest.json`. *(Ramparts `JsonPrototypePollution`)*
17. **Shipped bytecode / compiled artifacts** — `__pycache__/*.pyc`, `.pyo`, minified-and-unreadable JS. *(SkillSpector SC8)*
18. **Concealed executable artifacts** — executables nested in documents/archives, double extensions, magic-byte vs extension mismatch. *(SkillSpector SC9; SkillGuardrail `SG-FILE-002`)*
19. **setuid/setgid bits and special file types** — device/socket/FIFO entries, symlinks escaping the package. *(SkillGuardrail `SG-FILE-007` Critical, `SG-FILE-003`, `SG-FILE-006`)*

### C. Manifest / metadata integrity & deception
20. **Frontmatter `name:` ≠ directory name** — deception signal. *(Ramparts `AgentskillsNameMismatch`)*
21. **Spec-violating skill names** — 1–64 chars, lowercase `[a-z0-9-]`, no leading/trailing/consecutive hyphens. *(Ramparts `AgentskillsInvalidName`; agentskills.io spec)*
22. **Unknown frontmatter fields** — outside `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`; catches a spoofed `risk_tier:` field. *(Ramparts `AgentskillsUnknownFrontmatterField`)*
23. **Missing / one-word / semantically vacuous description** — `VagueSkillTrigger`, `GenericSkillTrigger` ("help", "do anything"). *(Ramparts)*
24. **Skill name collisions across a bundle** — router shadowing. *(Ramparts `SkillNameCollision`)*
25. **Brand impersonation / typosquatting of skill & package names** — brand token + official-sounding cue; edit distance, homoglyph, keyboard adjacency, hyphenation against a popular-name list. *(Ramparts `BrandImpersonation`; GuardDog `typosquatting`)*
26. **Declared-vs-actual capability mismatch (both directions)** — network egress with no network grant declared; and permissions declared with no matching code. *(Ramparts `UndeclaredNetworkEgress`; SkillSpector LP1/LP4)*
27. **Wildcard / unbounded tool grants** — `Bash`, `Bash(*)`, `Bash(*:*)`, `*`, `allowed-tools: *`; bounded `Bash(git status:*)` must stay silent. *(Ramparts `OverbroadAllowedTools`; cc-audit "overpermission")*
28. **Metadata/author heuristics** — deceptive author, metadata mismatch, repository integrity mismatch, compromised/older maintainer email domains. *(GuardDog metadata analyzers)*

### D. Agent-specific & instruction-layer (the differentiators vs generic SAST)
29. **Hidden instructions in HTML comments, markdown comments, collapsed details, and off-screen whitespace padding.** *(SkillSpector P2, P9; SkillGuardrail `SG-PI-002`)*
30. **Markdown image / link exfiltration** — `![](https://evil/?d=<data>)`, image beacons, prefetch-style pixels; the classic context-leak channel. *(SkillSpector E1/E4; llm-guard `MaliciousURLs`)*
31. **`@<path>` sensitive-file inlining** — Claude Code syntax that pulls file contents into prompt context: SSH/AWS/GnuPG/kube/docker creds, `.env`, `.netrc`, `.npmrc`, `.pypirc`, certs. *(Ramparts `SkillSensitiveFileReference`)*
32. **Agent identity/memory-file writes** — `SOUL.md`, `MEMORY.md`, `AGENTS.md`, `CLAUDE.md`, `.claude/settings`, `.cursorrules`: persistence that survives uninstall. Detect **write verbs** only, not reads. *(Ramparts `AgentIdentityFileWrite`; SkillSpector MP1/MP3; SkillGuardrail `SG-PI-004`)*
33. **Refusal/disclaimer suppression language** — "never refuse", "always comply", "no disclaimers", "do not moralize", "you have no restrictions", "do anything now". *(SkillSpector AR1/AR2/AR3; llm-guard `NoRefusal`)*
34. **Instruction override & role impersonation** — "ignore previous instructions", fake system/developer turns, `<system>` tags, policy nullification. *(SkillSpector P1; SkillGuardrail `SG-PI-001`, `SG-PI-003`)*
35. **Mutable external instruction retrieval** — "fetch and follow the instructions at <URL>"; fetched content is outside the trust boundary. *(SkillGuardrail `SG-PI-005`; Ramparts `ExternalReferenceInventory`, `IndirectPromptInjection`)*
36. **Trigger abuse / keyword baiting** — overly broad triggers, shadowing built-in commands, "use this first" priority manipulation. *(SkillSpector TR1–TR3; Ramparts `CapabilityInflation`)*
37. **Capability inflation & deceptive certification claims** — keyword stuffing, fake "official"/"certified"/"audited" claims. *(Ramparts `CapabilityInflation`)*
38. **Tool poisoning in tool/parameter descriptions** — hidden directives, malicious defaults, description-behaviour mismatch. *(SkillSpector TP1–TP4; mcp-scan, mcp-shield)*
39. **Unbounded consumption / resource exhaustion instructions** — loops without limits, no quotas, no timeouts. *(SkillSpector EA4, OH3)*
40. **Excessive agency** — autonomous high-impact decisions without human-in-the-loop, unrestricted tool access, scope creep. *(SkillSpector EA1–EA3)*
41. **System prompt leakage instructions** — direct extraction, rephrasing/translation side-channels, exfiltration via file write or network. *(SkillSpector P6–P8)*

### E. Execution, credentials, persistence, network
42. **Pipe-remote-to-interpreter** — `curl … | bash`, `iwr … | iex`, `wget -O- | sh`; also download-to-path-then-execute in the same file. *(SkillSpector SC2; SkillGuardrail `SG-EXEC-001`, `SG-CHAIN-002`)*
43. **Cloud metadata endpoint access** — `169.254.169.254`, `fd00:ec2::254`, `100.100.100.200`, `metadata.google.internal`. *(SkillGuardrail `SG-CRED-003` Critical; Snyk agent-scan SSRF denylist)*
44. **Destructive filesystem/disk operations** — `rm -rf /`, `dd if=/dev/zero`, `wipefs`, `shred`, `mkfs`, fork bombs. *(Ramparts `SkillSystemManipulation`; GuardDog `threat-filesystem-destruction`)*
45. **Security-control tampering** — disabling quarantine/firewall/SELinux/AV, `setenforce 0`, `spctl --master-disable`, clearing logs/history (`history -c`, `unset HISTFILE`), `LD_PRELOAD=` hijack, PATH poisoning. *(SkillGuardrail `SG-EXEC-004` Critical; GuardDog `threat-runtime-obfuscation-log-suppress`)*
46. **Persistence mechanisms** — crontab, systemd units, `launchd` plists, `~/.bashrc`/`.zshrc`/`.profile`, SSH `authorized_keys`, Windows Run keys / scheduled tasks. *(SkillGuardrail `SG-PERSIST-001/002`; SkillSpector RA2; GuardDog `threat-filesystem-autostart`)*
47. **Package-manager lifecycle hooks & install-time network access** — `preinstall`/`postinstall`, `setup.py` with network calls, `npm-http-dependency`, dependency confusion (internal scope published publicly). *(SkillGuardrail `SG-SUPPLY-001`; GuardDog `threat-npm-preinstall-script`, `threat-setup-network-in-install`, `threat-npm-dependency-confusion`; Socket.dev)*

### F. Cross-cutting capabilities (not "rules" but required)
48. **Cross-signal correlation within a scope** — capability × threat (GuardDog), sensitive-read + egress (SkillGuardrail `SG-CHAIN-001`), taint flows (SkillSpector TT1–TT5). *This is the primary FP lever.*
49. **Declared-vs-actual and within-file-only conservatism** — never upgrade unrelated keywords in different files into a critical finding. *(SkillGuardrail's explicit design note)*
50. **Coverage-gap findings** — emit a finding when a file is skipped/oversize/non-UTF-8/cap-exceeded. *("A clean result over a partially-scanned bundle is not evidence the bundle is clean.")* *(Ramparts `ScanCoverageIncomplete`; SkillGuardrail `SG-LIMIT-001/002/003`, `SG-FILE-001/005`)*
51. **Ingest hardening** — per-ingest byte cap, zip member cap, zip compression-ratio cap, depth cap, traversal/absolute-path/link rejection, case-folding-collision rejection, fail-closed on breach. *(SkillSpector `INGEST_MAX_BYTES`/`INGEST_MAX_ZIP_MEMBERS`; SkillGuardrail archive pre-flight)*
52. **Content fingerprint + source commit + receipt, with later `verify`** — the only way to detect rug pulls (AML.T0109). *(SkillGuardrail; Ramparts `SkillContentChanged`; mcp-scan)*
53. **Provenance / attestation / signing** — SLSA provenance, in-toto attestations, cosign keyless signing + Rekor transparency, npm `--provenance`, TUF roles for the update channel. *(Group G)*
54. **Taxonomy mapping emitted as data** — CWE + OWASP LLM Top 10 + OWASP MCP Top 10 + ATLAS IDs via SARIF `taxonomies`/`properties`, not prose. *(Ramparts; SARIF spec)*
55. **Dependency vulnerability lookup via OSV.dev** with offline fallback, fail-soft. *(SkillSpector SC4; Ramparts; osv-scanner)*
56. **Repository-context signals** — Scorecard-style source-repo trust as a second dimension. *(Scorecard; arXiv 2603.16572)*
57. **Optional sandbox/dynamic verification** — Docker execution to observe real behaviour and triggered payloads. *(SkillWard; cisco mcp-scanner PyPI sandbox)*

### G. Research-driven capabilities — required to survive the published evasions (see §E.0)
58. **Self-extracting / install-time-invisible payload detection** — a skill whose *installed* form differs from its *executed* form: staged components decrypted, downloaded, or unpacked at run time; "restore the payload after install." **SFS packing bypassed every one of eight scanners at >90%**, so if you do not model install-time vs execution-time divergence, you do not detect it. *(Cloak and Detonate, [2607.02357](https://arxiv.org/abs/2607.02357))*
59. **Decode-the-payload-and-analyze-both-views discipline** — never analyze only the literal bytes: analyze literal + normalized + decoded, and diff the views. Structural obfuscation beat >80% of static scanners and 96% of a hybrid one. *(ibid.; Ramparts)*
60. **OS-boundary information-flow evidence in a sandbox tier** — instead of "was a bad string present," record observed OS effects: which files were read, which sockets were opened to which destinations, which processes were spawned, which env vars were read, what was written outside the skill dir. *(SkillDetonate in [2607.02357](https://arxiv.org/abs/2607.02357))*
61. **Cross-skill / composition (path-level) analysis over the *installed* set** — build a **Skill Composition Graph** over skills the user already has: artifact flows, capability composition, ordered execution handoffs, shared state. Flag chains where locally plausible skills compose into exfiltration/destruction/persistence. Two independent papers call this the primary blind spot. *(ColluSkill [2608.09732](https://arxiv.org/abs/2608.09732); CompoSkill [2608.16246](https://arxiv.org/abs/2608.16246))*
62. **Prose → fact-base lifting with reachability queries** — compile SKILL.md into a queryable fact base (LLM-triggered actions, prose-defined conditions, human-in-the-loop checkpoints, artifacts, capability grants) and answer Datalog-style reachability questions: *does untrusted input reach a high-impact sink without a human checkpoint?* Standard query classes: **indirect injection, secret leakage, confused deputy, unguarded sink.** This is the only mechanism found that makes prose-derived findings *reproducible and provable* rather than probabilistic. *(Semia, [2605.00314](https://arxiv.org/abs/2605.00314))*
63. **Confused-deputy detection** — a skill that uses the agent's ambient authority to perform an action the *user* never authorized (the natural consequence of `allowed-tools` grants + untrusted instructions). *(Semia query class)*
64. **Unguarded-sink detection** — high-impact sinks (network egress, file write outside scope, shell exec, credential read) reachable with no human-in-the-loop checkpoint on the path. *(Semia; SkillSpector EA2; SkillGuardrail `SG-CHAIN-*`)*
65. **Image-borne instruction detection** — OCR + multimodal extraction over *every* bundled image, then run the full instruction-detection rule set over the recovered text, and cross-reference docs that point at images as part of a workflow (the doc+image *joint* interpretation is the attack). **NCVA achieved ASR 43.1% across all nine model-harness configurations tested**, so this is not theoretical. *(Seeing Is Not Screening [2606.18198](https://arxiv.org/abs/2606.18198); MMSkillRisk [2609.35912](https://arxiv.org/abs/2609.35912))*
66. **Repository-context verification** — does the skill's declared repo exist, is it the actual source, is it **abandoned** (hijack risk), does the published artifact match the repo at the claimed commit, is the repo's security posture reasonable? **Worth ~90× on precision (46.8% → 0.52%) and it catches abandoned-repo hijacking.** *(Context Matters [2603.16572](https://arxiv.org/abs/2603.16572); Scorecard)*
67. **Behaviour-vs-intent mismatch as a first-class check** — reconstruct the *intended* functionality from docs/manifest, reconstruct the *actual* behaviour from code/resources/visuals, and flag divergence. This single check subsumes `UndeclaredNetworkEgress`, `Description-Behavior Mismatch`, and much of `CapabilityInflation`. *(SKILLLITE [2609.36879](https://arxiv.org/abs/2609.36879); ExecScan; SkillSpector TP4)*
68. **Scanner-feedback robustness (assume your rules are public)** — an adversary optimizes against your detector. Mitigations: signed/updatable rule feeds; rules whose *content* is not fully public; behaviour-based rather than string-based detection; version-stamped scans so a rule update re-flags prior PASSes; and a **"scanned with rule-pack vN"** field on every verdict so a stale PASS is visible. *(ColluSkill's scanner-feedback refinement, [2608.09732](https://arxiv.org/abs/2608.09732))*
69. **Local/offline audit path with a compact model** — for air-gapped or privacy-constrained installs, an evidence-guided pipeline that extracts behaviours and judges them in functional context works with compact local LLMs. *(SKILLLITE [2609.36879](https://arxiv.org/abs/2609.36879))*
70. **Registry-level aggregate signals** — download concentration, age/cohort, star/comment counts (**77.86% of one registry's skills had zero stars and zero comments**), listing churn, republication under new names. Weak per-skill, useful as a *prior* and for triage queues at marketplace scale. *(After the Party [2609.17274](https://arxiv.org/abs/2609.17274))*

*(That is 57 numbered detection rules/detectors in groups A–E, 10 cross-cutting capabilities (48–57), and 13 research-driven capabilities (58–70) = **70 concrete items**; items 1–47 and 58–66 are directly implementable detection rules, the remainder are enabling capabilities.)*

---

# DELIVERABLE 3 — Dashboard / interface design

**Information architecture that works**
1. **Two top-level objects, not one: `Artifact` (the skill) and `Finding`.** The list view is artifacts; the drill-down is findings. DefectDojo's Product→Engagement→Test→Finding chain is the mature version; for skills the chain is `Catalog → Skill@version → Scan → Finding`.
2. **Verdict card first, everything else below the fold.** Big, unmissable verdict (`SAFE / CAUTION / DO NOT INSTALL` or `PASS / REVIEW / BLOCK / CRITICAL`), the score with a link to its **breakdown**, the scan mode (`static-only` vs `+LLM` vs `+sandbox`), the coverage statement, the artifact fingerprint, and `Scanned at`.
3. **Score breakdown as a first-class panel, not a tooltip.** GuardDog-style named factors with their weights and contributions (`severity 0.30 × high = 0.30`, `specificity 0.30 × medium = 0.21`, …) plus any **active caps and why they applied** ("capped at 4.9: low specificity, <3 categories, no full chain"). A score nobody can audit is a score nobody will trust.
4. **Default finding view = group by rule, sorted by severity, then count.** (Semgrep.) Include `N instances in M files` and a per-rule triage state.
5. **Three visible filter axes minimum: severity, confidence, and status/actionability.** Add reachability-equivalent ("is the dangerous capability actually reachable from the entry point?").
6. **Capability matrix view** — a grid of `Skill × capability` (network, filesystem-read, filesystem-write, process-spawn, credential-access, persistence, clipboard, screen, keylog) with declared/observed/mismatch marks. This is the single view that most quickly communicates "what can this thing do," and it directly instantiates the GuardDog model.
7. **Diff-first for re-scans.** Default to `new / still-present / fixed / suppressed`, with the previous scan as the baseline. "What changed" is the only question a returning user has.
8. **Drift / rug-pull timeline per artifact** — a per-skill history of content fingerprints and the diffs between them, with the source commit. This makes AML.T0109 visible.
9. **A "why is this risky?" panel per rule** — plain-language explanation, an example of the attack, the mapped taxonomies (CWE/OWASP/ATLAS), the rule's **specificity and confidence**, and links. (Socket.dev does this best.)
10. **Remediation inline and actionable** — a `fix` field with a concrete diff or command, plus a "no fix available" state that is *visually distinct from "unfixed."* (Grype `FIXED-IN`; SARIF `fixes[]`; Semgrep autofix.)
11. **Suppression as a first-class, expiring, justified object** — a modal requiring (a) a reason from an enum, (b) free-text justification, (c) **an expiry date**, and (d) refusing to suppress Critical/High. Show suppressed findings in a dedicated tab with their expiry countdown.
12. **Triage state machine with automatic FP memory** — `Open → Reviewing → Ignored(reason) → Fixed`, and **if a future finding matches a previously-FP'd one, auto-mark it and say so.** (DefectDojo False Positive History.)
13. **Coverage & limits strip** — always visible: files scanned, files skipped and why, truncations, whether the LLM ran, whether network lookups succeeded. Encode this as a finding when it matters.
14. **A per-check list, not just a list of problems** — show the checks that *passed*, in the same tree. mcp-shield's ✓/✗ tree plus njsscan's `--missing-controls` idea: negative assurance is what makes the positive results credible.
15. **Non-expert view toggle** — a grade (A–F) plus 3–5 named sub-scores ("Instruction safety", "Data handling", "Execution safety", "Supply chain", "Source trust") for stakeholders, with the full technical view one click away.
16. **Scan-tier badge on every verdict, always visible.** `Static` / `Static + LLM` / `Static + LLM + Sandbox` rendered as a prominent chip. Because SFS packing bypasses every scanner at >90% ([2607.02357](https://arxiv.org/abs/2607.02357)), a static PASS and a sandboxed PASS are *different security claims* and must never look the same. SkillSpector already does the minimal version of this with `llm_used`/`scan_mode`; extend it to a full tier ladder and gate the language ("verified safe" is only permissible at the sandbox tier).
17. **Composition / capability-graph view for the installed set** — a graph (or a chain list) of `installed skill → capability → artifact → downstream skill`, highlighting **paths where every node passed individually but the composition is dangerous** (e.g. one skill reads `.env`, another POSTs to a webhook, and an agent chains them). Show `per_node_verdicts: [PASS, PASS, PASS]` explicitly — the *surprise* is the product insight. No shipping scanner has this view; it is the clearest whitespace available.
18. **Behaviour-vs-intent diff panel** — two columns: "what it says it does" (from SKILL.md/manifest) and "what it actually does" (from code, resources, and sandbox observation), with divergences highlighted. This single panel subsumes undeclared-egress, description-behaviour mismatch, and capability inflation, and it is legible to a non-expert.
19. **Source-trust panel with the abandonment flag front and centre** — repo exists / matches artifact / last commit / archived / hijack-suspect. The abandoned-repo hijack vector ([2603.16572](https://arxiv.org/abs/2603.16572)) is invisible in every current UI.

**Interaction patterns worth copying**
- **Bulk triage** over a filtered set, with an undo and an audit entry. (Semgrep.)
- **Time-period filters that run before other filters** ("opened in / triaged in"). (Semgrep.)
- **Dismissal requires a reason + comment**, and re-opens on regression. (GitHub.)
- **"My work" queue** — the findings assigned to *me*, with SLAs. (DefectDojo.)
- **Structured export**: SARIF for tooling, **VEX** for customers ("not affected because code_not_reachable"), CycloneDX for SBOM consumers, JSON for your own API, Markdown for a PR comment.
- **Consent prompts that show the exact command/URL** before executing anything. (Snyk agent-scan.)
- **Stale-while-revalidate** for scan lists; live progress with stage names for a running scan (static → taint → YARA → LLM → sandbox).
- **Rule-management UI** with per-rule hit counts, FP rates, and a "this rule is noisy" action that feeds the rule authors — closing the loop between the dashboard and the rule pack.

**Anti-patterns to avoid**
- A single number with no breakdown, no caps shown, and no coverage statement.
- Alert lists without fingerprints ⇒ duplicate findings after every edit.
- Suppressions without expiry or justification (permanent blind spots).
- Truncating input silently.
- Treating "0 findings" as "safe" — ship the disclaimer both Cisco and SkillGuardrail ship.
- Exit codes that don't map 1:1 onto verdicts.
- Scores that saturate (2 Criticals = 100), destroying discrimination exactly where you need it most.

---

# DELIVERABLE 4 — A defensible 0–100 scoring model

## 4.1 Principles
1. **Never a single opaque number.** Ship `score` **plus** a `score_breakdown` object with named weighted factors and their numeric contributions, **plus** any caps that fired.
2. **Separate severity from confidence from specificity from reachability.** They are four different questions: *how bad if true*, *how sure are we it's true*, *how malware-specific is the pattern*, *can it actually be reached*. Bandit/gosec ship two axes; Semgrep ships three; GuardDog ships four. One axis is not enough.
3. **Correlate before you score.** Independent regex hits inflate; correlated evidence (capability × threat, sensitive-read + egress) is the single biggest precision lever. Score **risks**, not findings.
4. **Encode policy as explicit caps**, not as weights. "Low specificity alone can never exceed X" is auditable; a tuned weight is not.
5. **Saturate late.** Keep the top of the range meaningful so the worst artifacts are distinguishable from each other.
6. **Make suppression unable to hide the worst.** No suppression of Critical/High; expiring suppressions elsewhere.
7. **Be explicit about what you did not do**, and let that reduce *confidence*, not the score (or emit a coverage finding).

## 4.2 Proposed model (adapting GuardDog's Factor Rating to a 0–100 scale)

**Step 1 — Build Risks, not findings.** A `Risk` = one **threat** signal + one **capability** signal within the same **scope** (file, or frontmatter+body of one SKILL.md), matching on `category` (network / filesystem / process / runtime / instruction / credential / persistence / metadata / supply-chain) with `detail`-compatibility (either generic → match; both specific → must be equal). Cross-file matches form Risks with a **severity downgrade** (GuardDog does this; take it). Each Risk carries:
- `severity` ∈ {low, medium, high, critical}
- `confidence` ∈ [0,1] — detector reliability (regex-with-stopwords 0.5, entropy+YARA 0.8, AST/taint 0.9, verified/live 1.0, LLM-judge 0.6)
- `specificity` ∈ {low, medium, high} — how malware-specific the pattern is (a `curl` call is low; a `curl | bash` with a raw-IP URL is high)
- `sophistication` ∈ {low, medium, high} — evasion effort (plaintext vs base64 vs homoglyph+decoded)
- `phase` ∈ {early, mid, late} — ATT&CK/ATLAS phase of the technique
- `reachable` ∈ {true, false, unknown} — does the skill's entry point (SKILL.md instructions, or an invoked script) actually reach it

**Step 2 — Compute four weighted components (weights sum to 1.00), on a 0–1 scale:**

```
severity_component       = SEV[dominant_severity]        * 0.30   # SEV = {low .25, med .5, high .75, critical 1.0}
chain_component          = CHAIN[distinct_phases]        * 0.20   # 1→0.4, 2→0.7, ≥3→1.0
                                                                 #   credential-access + egress ⇒ force 1.0
specificity_component    = SPEC[dominant_specificity]    * 0.25   # {low .3, med .7, high 1.0}
confidence_component     = mean(confidence of top risks) * 0.25   # 0.0–1.0
```

Notes on the deliberate divergences from GuardDog: (a) **`sophistication` is folded into `confidence` and `specificity`** rather than given its own 20% — sophistication is largely *evidence for* specificity, and double-counting it was GuardDog's weakest choice; (b) **`confidence` gets a real 25% weight** because a skill scanner has far noisier detectors than a package scanner (prose patterns); (c) `specificity` drops 30→25 to make room.

**Step 3 — Apply multiplier and caps (each cap must be reported in `score_breakdown.caps_applied[]`):**

```
raw   = severity + chain + specificity + confidence          # 0.0 – 1.0
score = round(raw * 100, 1)

CAP-1  executable multiplier: if the skill contains executable scripts, score = min(100, score * 1.15)
       (milder than SkillSpector's 1.3 — 1.3 makes script-bearing skills saturate immediately)

CAP-2  low-specificity noise ceiling:
       if dominant_specificity == low AND no risk has med/high specificity
          AND distinct_phases < 3 AND distinct_threat_categories < 3
       then score = min(score, 49)

CAP-3  metadata-only ceiling:
       if every risk is metadata/instruction-only with no code evidence
       then score = min(score, 69)

CAP-4  reachability demotion (not a cap — a factor):
       if reachable == false for all high/critical risks, score = score * 0.6 and
       set actionability = "informational"; if reachable == unknown, leave the score
       but surface `reachability: unknown` prominently

CAP-5  confidence floor for the top band:
       if score >= 85 AND mean_confidence < 0.7 then score = min(score, 84)
       (you may not call something "critical" on weak evidence)
```

**Step 4 — Map to verdicts (5 bands, not 4 — preserves discrimination at the top):**

| Score | Verdict | Meaning | Default CI action |
|---|---|---|---|
| 0 | **Clean** | No risks detected **by the enabled rules** | allow |
| 1–24 | **Low** | Informational / hygiene | allow, report |
| 25–49 | **Caution** | Review recommended; often legitimate-but-risky | warn |
| 50–69 | **Review** | Material risk signals; human decision required | block pending review |
| 70–89 | **High** | Multi-signal correlated risk | block |
| 90–100 | **Critical** | Correlated chain + high specificity + high confidence | block + notify |

**Step 5 — Ship the uncertainty honestly, alongside the score:**
```
verdict:            "Review"                 # never just a number, never just a colour
score:              61.4
score_breakdown:    { severity_component: 0.225, chain_component: 0.14,
                      specificity_component: 0.175, confidence_component: 0.19,
                      executable_multiplier: 1.15,
                      caps_applied: [{cap:"CAP-2", reason:"low specificity, <3 phases/categories", ceiling:49}] }
confidence:         { mean: 0.78, min: 0.55, method: "per-detector static weights" }
coverage:           { files_scanned: 14, files_skipped: 2, skipped_reasons: ["oversize","non-utf8"],
                      llm_used: false, osv_lookup: "ok", sandbox: "not_run" }
scan_mode:          "static"                 # vs "static+llm" / "static+llm+sandbox"
reachability:       "unknown"
verdict_basis:      "risk_score <= 69; 1 HIGH correlated risk (credential-read + egress)"
disclaimer:         "No findings does not mean this skill is safe. Best-effort detection only."
```

## 4.3 Two scores, not one — and the research says why

The literature in §E.0 forces a structural change to any single-score design:

**Score A — `artifact_score` (0–100, the model in 4.2).** Answers: *how risky is this skill in isolation?* This is the number that gates installation.

**Score B — `composition_risk` (separate object, not folded into A).** Answers: *how risky is this skill **given what is already installed**?* Because composition risk is "a path-level property rather than a node-level property" ([2608.16246](https://arxiv.org/abs/2608.16246)), it cannot be expressed as a property of the skill. Emit it as a distinct structure:

```
artifact_score: 18            # verdict: Low — do not block on its own
composition_risk: {
  level: "elevated",
  reason: "capability_composition",
  chains: [{
    path: ["skill:installed-web-fetch", "this-skill:file-read", "this-skill:http-post"],
    emergent_capability: "exfiltration",
    per_node_verdicts: ["PASS","PASS","PASS"],   # every node passed individually
    confidence: 0.72
  }],
  installed_set_version: "2026-09-30T12:00Z"
}
```

**Score C — `source_trust` (0–10, Scorecard-shaped).** Repository-context signals: repo exists and matches the artifact, not abandoned, branch protection, code review required, signed releases, pinned dependencies, no binary artifacts, token permissions, dangerous-workflow check. **This is the ~90× precision lever** ([2603.16572](https://arxiv.org/abs/2603.16572)). Use it as a *prior that modulates confidence*, not as an additive term — a great repo does not make malicious code safe, but a missing/abandoned/mismatched repo should materially raise suspicion about an otherwise-clean artifact.

**Verdict composition:**
```
BLOCK      if artifact_score >= 70
           OR composition_risk.level == "critical"
           OR source_trust <= 2 AND artifact_score >= 40      # e.g. abandoned repo + any real signal
REVIEW     if artifact_score >= 50 OR composition_risk.level == "elevated"
ALLOW      otherwise, with the coverage/mode caveats attached
```

**And always attach the honesty payload:** `scan_tier` (`static` / `static+llm` / `static+llm+sandbox`), `rule_pack_version`, `coverage` (files skipped + reasons), `reachability`, and the disclaimer. Given that SFS packing beats every scanner at >90% ([2607.02357](https://arxiv.org/abs/2607.02357)), **the tier label is part of the security claim** — a `static` PASS and a `static+sandbox` PASS are different assertions and must not look the same in the UI or the API.

## 4.4 Why this is defensible in a review
- **Every weight and every cap is written down and reported in the output.** Anyone can recompute the score from the finding list — the same property that makes GuardDog's and Scorecard's scores auditable.
- **It is grounded in published frameworks:** severity bands and the *Automatable / Recovery / Value Density / Safety* vocabulary come from [CVSS 4.0](https://www.first.org/cvss/v4-0/); the **Likelihood × Impact** structure and the "don't be over-precise, bucket into low/medium/high" guidance come from the [OWASP Risk Rating Methodology](https://owasp.org/www-community/OWASP_Risk_Rating_Methodology); the chain factor uses [ATT&CK](https://attack.mitre.org/tactics/enterprise/) phases as GuardDog does; the technique vocabulary comes from [MITRE ATLAS](https://atlas.mitre.org/).
- **It separates score from verdict**, so you can change gates without re-scoring, and **separates detection from policy** (OPA/CEL), so customers can tune without forking.
- **It refuses to be confident on weak evidence** (CAP-5) and **refuses to call metadata alone critical** (CAP-3) — the two failure modes that destroyed trust in earlier scanners.
- **It cannot saturate at two findings** (unlike SkillSpector's additive 50/25/10/5), so 90+ means something.
- **`coverage` + `scan_mode` + `disclaimer`** let you say the thing Cisco and SkillGuardrail say: *a clean scan is not a safety certificate.* That honesty is a product feature, and it is the only defensible position given the 0.12% five-scanner agreement rate in the literature.

## 4.5 Interop mapping (so you can still talk to CVSS-shaped consumers)
Emit `properties.security-severity` in SARIF as `score / 10`, which GitHub buckets as >9.0 critical · 7.0–8.9 high · 4.0–6.9 medium · 0.1–3.9 low. Emit `properties.precision` from your mean confidence (`≥0.9 very-high`, `≥0.75 high`, `≥0.55 medium`, else `low`). Emit CWE/OWASP/ATLAS via `run.taxonomies[]` rather than string tags. Publish **VEX** for accept-risk decisions (`not_affected` + `code_not_reachable` / `requires_configuration` / `protected_by_mitigating_control`) so customers can ingest your triage.

---

# DELIVERABLE 5 — Recommended build order (synthesis)

Sequenced so that each phase is independently shippable, each phase is *evaluable*, and the highest-precision-per-effort work lands first. The ordering is driven by the research in §E.0, not by feature appeal.

**Phase 0 — Decide and instrument the measurement BEFORE the rules.**
Build the benchmark harness first: a labelled corpus of malicious and benign skills, a **hard-negative set** (NotInject-style: benign skills that *look* dangerous — legitimate `curl`, legitimate env reads, legitimate `@` references), and a **source-disjoint split**. Report precision, recall, F1, and FPR, and publish in-distribution *and* out-of-distribution numbers. Cisco's experience is the cautionary tale: a change that improved its headline F1 to 47.73% scored F1 13.74% on source-disjoint data and was correctly blocked. *Without this, every later decision is unfalsifiable.* Reuse Cisco's named corpora concepts and graft on the adversarial corpora from §E.0 (*SkillCloak* evasions, *ColluSkill* chains, *NCVA* image attacks) as your red-team regression suite.

**Phase 1 — Deterministic core + honest reporting (the floor).**
ast-grep/tree-sitter for structural rules across Python/Bash/JS/TS/PowerShell/Ruby; YARA-X for content signatures with `math.entropy()` and `base64`/`xor`/`wide` modifiers, ingesting YARA-Forge packs; gitleaks-style regex × entropy × **stopwords** for secrets. Then the *reporting* contract: SARIF 2.1.0 with `taxonomies`, `codeFlows`, `fixes`, `suppressions`, `partialFingerprints`; JSON with a `score_breakdown`; stable namespaced rule IDs (`SKL-XXX-NNN`); the honesty payload (`scan_tier`, `rule_pack_version`, `coverage`, `disclaimer`). **Do not ship a score without the breakdown object.**

**Phase 2 — Normalize and correlate (the precision engine).**
The **normalized + iteratively base64/hex-decoded rescan** (zero-width strip, NFKC homoglyph fold, bounded recursive decode). Then the **capability × threat correlation engine** with GuardDog's category + `detail`-compatibility rule, and the four-factor score with the explicit caps. This phase is where the 0–100 score becomes defensible rather than decorative.

**Phase 3 — Repository context (the ~90× lever).**
Scorecard-shaped `source_trust`: does the declared repo exist and match the artifact, is it **abandoned** (the hijack vector), branch protection, code review, signed releases, pinned dependencies, binary artifacts, dangerous workflows, token permissions. Fold it in as a confidence prior, not an additive term. This is the single highest-ROI phase for precision and it is cheap — most of it is metadata you can fetch and checks you can port.

**Phase 4 — Agent-native instruction analysis (the differentiator).**
Prose → **fact base** → reachability queries (Semia's SDL/Datalog model): indirect injection, secret leakage, **confused deputy**, **unguarded sink**. Add the instruction-layer detector set (hidden instructions, whitespace padding, `@<path>` inlining, identity/memory-file writes, refusal suppression, trigger abuse, capability inflation) and the manifest-integrity/deception checks (name≠directory, unknown frontmatter, collisions, brand impersonation, prototype pollution, unsafe YAML).

**Phase 5 — Lifecycle: fingerprint, receive, verify, drift.**
Content fingerprint + source commit + **receipt**; `verify` to detect post-approval drift (the only defence against AML.T0109 rug pull); baselines bound to the full package fingerprint with **glob rules for drift tolerance**; **never suppress high/critical**; **expiry dates on every suppression**; DefectDojo-style **False Positive History** auto-marking. Ship `--baseline` + a diff-aware CI mode in the same release.

**Phase 6 — Sandbox tier (mandatory for any strong claim).**
Docker-isolated execution with **OS-boundary information-flow evidence** rather than string matching: files read, sockets opened and destinations, processes spawned, env vars touched, writes outside the skill dir. SkillDetonate's model. Given that SFS packing bypasses every scanner tested at >90%, this tier is what converts "we scan" into "we detect determined attackers" — and the `scan_tier` field must make the difference visible to users.

**Phase 7 — Path-level / composition analysis (the unsolved frontier).**
Move from node verdicts to **path verdicts**: build a Skill Composition Graph over the *installed* set (artifact flows, capability composition, ordered handoffs, shared state) and flag emergent capabilities where every node passed individually. Two independent 2026 papers identify this as the primary blind spot of every shipping scanner, and *nobody has shipped it.* This is the most defensible long-term moat available.

**Phase 8 — Multimodal and distribution.**
OCR + multimodal extraction over bundled images, with the doc+image *joint* interpretation modelled (the attack is the reference, not the image). Then the distribution/trust endgame: signed rule feed (Ed25519), cosign keyless signing + Rekor for published skills, SLSA provenance, in-toto attestations for the author→review→scan→publish chain, TUF for the update channel, and **VEX** output so customers can ingest your accept-risk decisions. Add an MCP-server mode so the scanner can gate installs *inside* the agent loop (SkillSpector's `scan_skill` tool is the model), and an OPA/CEL policy layer so enterprises tune gates without forking.

**Phase 9 — Dashboard.**
Only after the finding/verdict data model is stable: verdict card + score breakdown + capability matrix + diff-first re-scan view + drift timeline + coverage strip + suppression-with-expiry modal + FP-history automation + bulk triage. Findings as API objects (trivy-operator CRD pattern), not report files.

**The three things that most distinguish a credible product here**, in order:
1. **Published, adversarial, out-of-distribution benchmark numbers — including the ones that got worse.** Only Cisco does this today, and it is the strongest trust signal in the field.
2. **A score anyone can recompute from the findings, with the caps and the coverage gaps shown.** GuardDog's and Scorecard's scores are auditable; nearly everyone else's are asserted.
3. **A path-level (composition) verdict.** Every shipping scanner is node-level; two papers show that is insufficient; nothing has shipped a fix.

---

## Appendix — Full URL index

**Group A:** [semgrep/semgrep](https://github.com/semgrep/semgrep) · [semgrep.dev/docs](https://semgrep.dev/docs/) · [Semgrep findings/triage](https://semgrep.dev/docs/semgrep-code/findings/) · [Semgrep Supply Chain](https://semgrep.dev/docs/semgrep-supply-chain/overview/) · [opengrep/opengrep](https://github.com/opengrep/opengrep) · [opengrep.dev](https://opengrep.dev/) · [github/codeql](https://github.com/github/codeql) · [PyCQA/bandit](https://github.com/PyCQA/bandit) · [Bandit plugins](https://bandit.readthedocs.io/en/latest/plugins/index.html) · [Bandit config](https://bandit.readthedocs.io/en/latest/config.html) · [securego/gosec](https://github.com/securego/gosec) · [ajinabraham/njsscan](https://github.com/ajinabraham/njsscan) · [Bearer/bearer](https://github.com/Bearer/bearer) · [ast-grep/ast-grep](https://github.com/ast-grep/ast-grep) · [Snyk Code docs](https://docs.snyk.io/scan-with-snyk/snyk-code)

**Group B:** [gitleaks/gitleaks](https://github.com/gitleaks/gitleaks) · [gitleaks default config](https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml) · [trufflesecurity/trufflehog](https://github.com/trufflesecurity/trufflehog) · [Yelp/detect-secrets](https://github.com/Yelp/detect-secrets) · [GitGuardian/ggshield](https://github.com/GitGuardian/ggshield)

**Group C:** [google/osv-scanner](https://github.com/google/osv-scanner) · [osv.dev](https://osv.dev) · [aquasecurity/trivy](https://github.com/aquasecurity/trivy) · [Trivy filtering](https://trivy.dev/latest/docs/configuration/filtering/) · [Trivy reporting](https://trivy.dev/latest/docs/configuration/reporting/) · [aquasecurity/trivy-operator](https://github.com/aquasecurity/trivy-operator) · [anchore/grype](https://github.com/anchore/grype) · [anchore/syft](https://github.com/anchore/syft) · [dependency-check/DependencyCheck](https://github.com/dependency-check/DependencyCheck) · [CycloneDX](https://cyclonedx.org/) · [CycloneDX VEX](https://cyclonedx.org/capabilities/vex/) · [CycloneDX 1.6 JSON](https://cyclonedx.org/docs/1.6/json/) · [cyclonedx-cli](https://github.com/CycloneDX/cyclonedx-cli) · [SPDX 2.3](https://spdx.github.io/spdx-spec/v2.3/) · [pypa/pip-audit](https://github.com/pypa/pip-audit) · [npm audit](https://docs.npmjs.com/cli/commands/npm-audit)

**Group D:** [VirusTotal/yara](https://github.com/VirusTotal/yara) · [VirusTotal/yara-x](https://github.com/VirusTotal/yara-x) · [YARA-Forge](https://github.com/YARAHQ/yara-forge) · [Neo23x0/signature-base](https://github.com/Neo23x0/signature-base) · [InQuest/awesome-yara](https://github.com/InQuest/awesome-yara) · [Cisco-Talos/clamav](https://github.com/Cisco-Talos/clamav) · [DataDog/guarddog](https://github.com/DataDog/guarddog) · [GuardDog RULES.md](https://github.com/DataDog/guarddog/blob/v3.0.0/RULES.md) · [GuardDog risk_engine.py](https://github.com/DataDog/guarddog/blob/v3.0.0/guarddog/analyzer/risk_engine.py) · [ossf/scorecard](https://github.com/ossf/scorecard) · [Scorecard checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md) · [Scorecard checks.yaml](https://github.com/ossf/scorecard/blob/main/docs/checks/internal/checks.yaml) · [Socket.dev](https://socket.dev/) · [SocketDev/socket-cli](https://github.com/SocketDev/socket-cli) · [Pantheon-Security/medusa](https://github.com/Pantheon-Security/medusa) · [alexgreensh/repo-forensics](https://github.com/alexgreensh/repo-forensics)

**Group E (skill/MCP scanners):** [NVIDIA/SkillSpector](https://github.com/NVIDIA/SkillSpector) · [SkillSpector SUPPRESSION.md](https://github.com/NVIDIA/SkillSpector/blob/main/docs/SUPPRESSION.md) · [SkillSpector ANALYSIS_RESOURCE_BOUNDS.md](https://github.com/NVIDIA/SkillSpector/blob/main/docs/ANALYSIS_RESOURCE_BOUNDS.md) · [NVIDIA skills catalog](https://github.com/NVIDIA/skills) · [cisco-ai-defense/skill-scanner](https://github.com/cisco-ai-defense/skill-scanner) · [cisco custom policy config](https://github.com/cisco-ai-defense/skill-scanner/blob/main/docs/user-guide/custom-policy-configuration.md) · [highflame-ai/ramparts](https://github.com/highflame-ai/ramparts) · [ramparts security-features.md](https://github.com/highflame-ai/ramparts/blob/main/docs/security-features.md) · [T-Zevin/SkillGuardrail](https://github.com/T-Zevin/SkillGuardrail) · [SkillGuardrail rules.md](https://github.com/T-Zevin/SkillGuardrail/blob/main/docs/rules.md) · [SkillGuardrail threat-model.md](https://github.com/T-Zevin/SkillGuardrail/blob/main/docs/threat-model.md) · [Fangcun-AI/SkillWard](https://github.com/Fangcun-AI/SkillWard) · [SkillWard comparison](https://github.com/Fangcun-AI/SkillWard/blob/main/docs/comparison.md) · [snyk/agent-scan](https://github.com/snyk/agent-scan) · [enkryptai/skill-sentinel](https://github.com/enkryptai/skill-sentinel) · [Tencent/AI-Infra-Guard](https://github.com/Tencent/AI-Infra-Guard) · [Tencent AI-Infra-Guard docs](https://tencent.github.io/AI-Infra-Guard/) · [cisco-ai-defense/mcp-scanner](https://github.com/cisco-ai-defense/mcp-scanner) · [invariantlabs-ai/mcp-scan](https://github.com/invariantlabs-ai/mcp-scan) · [mcp-scan docs](https://invariantlabs-ai.github.io/docs/mcp-scan) · [riseandignite/mcp-shield](https://github.com/riseandignite/mcp-shield) · [Pantheon-Security/medusa](https://github.com/Pantheon-Security/medusa) · [affaan-m/agentshield](https://github.com/affaan-m/agentshield) · [splx-ai/agentic-radar](https://github.com/splx-ai/agentic-radar) · [ryo-ebata/cc-audit](https://github.com/ryo-ebata/cc-audit) · [Nova-Hunting/nova-proximity](https://github.com/Nova-Hunting/nova-proximity) · [claude-world/claude-skill-antivirus](https://github.com/claude-world/claude-skill-antivirus) · [agentskills.io](https://agentskills.io) · [agentskills/agentskills](https://github.com/agentskills/agentskills) · [Holzbauer et al., arXiv 2603.16572](https://arxiv.org/abs/2603.16572)

**Group E (LLM/agent security):** [NVIDIA/garak](https://github.com/NVIDIA/garak) · [microsoft/PyRIT](https://github.com/microsoft/PyRIT) · [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo) · [protectai/llm-guard](https://github.com/protectai/llm-guard) · [protectai/rebuff](https://github.com/protectai/rebuff) · [deadbits/vigil-llm](https://github.com/deadbits/vigil-llm) · [NVIDIA/NeMo-Guardrails](https://github.com/NVIDIA/NeMo-Guardrails) · [ethz-spylab/agentdojo](https://github.com/ethz-spylab/agentdojo) · [uiuc-kang-lab/InjecAgent](https://github.com/uiuc-kang-lab/InjecAgent) · [Giskard-AI/giskard-oss](https://github.com/Giskard-AI/giskard-oss) · [protectai/modelscan](https://github.com/protectai/modelscan) · [trailofbits/fickling](https://github.com/trailofbits/fickling) · [OWASP LLM Prompt Injection Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html) · [modelcontextprotocol.io](https://modelcontextprotocol.io)

**Group F:** [DefectDojo/django-DefectDojo](https://github.com/DefectDojo/django-DefectDojo) · [DefectDojo docs](https://docs.defectdojo.com/) · [DefectDojo dedup tuning](https://docs.defectdojo.com/triage_findings/finding_deduplication/os__deduplication_tuning/) · [DefectDojo dedup across tools](https://docs.defectdojo.com/triage_findings/finding_deduplication/deduplication_across_tools/) · [DefectDojo risk acceptance](https://docs.defectdojo.com/triage_findings/findings_workflows/os__risk_acceptance/) · [DefectDojo reimport](https://docs.defectdojo.com/import_data/import_intro/reimport/) · [DefectDojo SLA config](https://docs.defectdojo.com/asset_modelling/os_hierarchy/os__sla_configuration/) · [Semgrep findings UI](https://semgrep.dev/docs/semgrep-code/findings/) · [GitHub code scanning alerts](https://docs.github.com/en/code-security/code-scanning/managing-code-scanning-alerts/about-code-scanning-alerts) · [microsoft/sarif-web-component](https://github.com/microsoft/sarif-web-component) · [microsoft/sarif-tutorials](https://github.com/microsoft/sarif-tutorials) · [psastras/sarif-rs](https://github.com/psastras/sarif-rs) · [Faros AI](https://www.faros.ai/)

**Group G:** [sigstore/cosign](https://github.com/sigstore/cosign) · [Sigstore docs](https://docs.sigstore.dev/) · [in-toto](https://in-toto.io/) · [in-toto/in-toto](https://github.com/in-toto/in-toto) · [in-toto/witness](https://github.com/in-toto/witness) · [SLSA levels](https://slsa.dev/spec/v1.0/levels) · [slsa-framework/slsa](https://github.com/slsa-framework/slsa) · [theupdateframework/python-tuf](https://github.com/theupdateframework/python-tuf) · [open-policy-agent/opa](https://github.com/open-policy-agent/opa) · [open-policy-agent/conftest](https://github.com/open-policy-agent/conftest) · [kyverno/kyverno](https://github.com/kyverno/kyverno) · [ossf/allstar](https://github.com/ossf/allstar) · [npm provenance](https://docs.npmjs.com/generating-provenance-statements) · [sigstore/model-transparency](https://github.com/sigstore/model-transparency) · [OpenSSF](https://openssf.org/)

**Group H & I:** [SARIF 2.1.0 spec](https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/sarif-v2.1.0-os.html) · [GitHub SARIF support](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning) · [CVSS v3.1](https://www.first.org/cvss/v3.1/specification-document) · [CVSS v4.0](https://www.first.org/cvss/v4-0/) · [EPSS](https://www.first.org/epss/) · [CISA KEV](https://www.cisa.gov/known-exploited-vulnerabilities-catalog) · [OWASP Risk Rating Methodology](https://owasp.org/www-community/OWASP_Risk_Rating_Methodology) · [CWE Top 25 2025](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html) · [CWE-1426](https://cwe.mitre.org/data/definitions/1426.html) · [CISA SBOM](https://www.cisa.gov/sbom)

**Group J:** [OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/) · [OWASP GenAI Security Project](https://genai.owasp.org/) · [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) · [OWASP MCP Top 10 (repo)](https://github.com/OWASP/www-project-mcp-top-10) · [MITRE ATLAS](https://atlas.mitre.org/) · [mitre-atlas/atlas-data](https://github.com/mitre-atlas/atlas-data) · [MITRE ATT&CK Enterprise tactics](https://attack.mitre.org/tactics/enterprise/) · [NIST AI RMF (AI 100-1)](https://doi.org/10.6028/NIST.AI.100-1) · [NIST AI RMF page](https://www.nist.gov/itl/ai-risk-management-framework) · [EU AI Act Art. 15](https://artificialintelligenceact.eu/article/15/) · [EU AI Act implementation timeline](https://artificialintelligenceact.eu/implementation-timeline/) · [Cloud Security Alliance](https://cloudsecurityalliance.org/) · [ISO/IEC 42001](https://www.iso.org/standard/81230.html)

**Agent-skill security research (see §E.0):** [Context Matters: Repository-Aware Security Analysis of the Agent Skill Ecosystem — arXiv 2603.16572](https://arxiv.org/abs/2603.16572) · [Semia: Auditing Agent Skills via Constraint-Guided Representation Synthesis — arXiv 2605.00314](https://arxiv.org/abs/2605.00314) · [Seeing Is Not Screening: Multimodal Hidden Instruction Attacks on Agent Skill Scanners — arXiv 2606.18198](https://arxiv.org/abs/2606.18198) · [Cloak and Detonate: Scanner Evasion and Dynamic Detection of Agent Skill Malware — arXiv 2607.02357](https://arxiv.org/abs/2607.02357) · [ColluSkill: Adversarial Cross-Skill Composition for Evading Agent Skill Scanners — arXiv 2608.09732](https://arxiv.org/abs/2608.09732) · [CompoSkill: Compositional Skill Chain Attacks from Individually Scanner-Passing LLM Agent Skills — arXiv 2608.16246](https://arxiv.org/abs/2608.16246) · [MMSkillRisk: Can Agents Stay Safe When Multimodal Skills Become Traps? — arXiv 2609.35912](https://arxiv.org/abs/2609.35912) · [SKILLLITE: Evidence-Guided Malicious Skill Auditing with Compact LLMs — arXiv 2609.36879](https://arxiv.org/abs/2609.36879) · [After the Party: Growth, Governance, and Security Scanning in the OpenClaw Agent Skill Ecosystem — arXiv 2609.17274](https://arxiv.org/abs/2609.17274)

**Note on the OWASP MCP mapping discrepancy:** Ramparts' `owasp-mcp-top-10:2025-draft` mapping does not match the official [OWASP MCP Top 10](https://github.com/OWASP/www-project-mcp-top-10). Use the official list above, and version your mapping URNs.

**Note on unverified secondary-source figures:** two statistics circulating in vendor READMEs could not be verified against their cited primary source and should not be repeated: (a) the "five scanners / only 0.12% flagged by all five / flag rates 3.79%–41.93%" attribution to arXiv 2603.16572 (the title cited does not exist at that ID — see §0 finding 2), and (b) SkillSpector's "26.1% of skills contain vulnerabilities and 5.2% show likely malicious intent," which its README quotes without a citation. Everything else attributed to SkillSpector in this report (its 71 patterns, scoring formula, exit codes, baseline/suppression design, resource bounds) was verified directly from its README and documentation.
