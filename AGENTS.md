<!-- markdownlint-configure-file { "MD013": { "tables": false } } -->

# Katalog Skill OpenCode

Daftar lengkap semua skill yang tersedia secara global di lingkungan
OpenCode ini, diurutkan berdasarkan domain. Setiap skill muncul tepat
satu kali. Sumber jalur (path provenance) dituliskan untuk menunjukkan
asal registri.

---

## UI / Frontend Engineering

Skill untuk desain visual, komponen, tata letak, dan polish antarmuka.

| Skill | Deskripsi | Sumber |
| ------- | ----------- | -------- |
| **frontend-ui-ux** | OCS override untuk upstream `frontend-ui-ux`, menerapkan visual direction `impeccable-style` secara otomatis untuk pekerjaan visual-engineering. | `skills/frontend-ui-ux` |
| **impeccable** | Desain dan iterasi frontend interface production-grade. Mencakup UX review, visual hierarchy, information architecture, accessibility, responsive, theming, typography, motion, micro-interactions, design systems. Untuk UI/UX tasks, bukan backend. | `skills/impeccable` |
| **impeccable-style** | Governance opsional untuk kode UI/UX. Auto-trigger hanya ketika pekerjaan membutuhkan high-polish styling review. Jangan load sebagai default global. | `skills/impeccable-style` |

---

## OCS (OpenCode System) — Internal Tooling

Skill khusus untuk memelihara dan mengelola OpenCode System itu sendiri.

| Skill | Deskripsi | Sumber |
| ------- | ----------- | -------- |
| **ocs-cocoindex-bootstrap** | Owner untuk CocoIndex bootstrap, wrapper discovery, repair, recovery. Ketika `ccc mcp` hilang, unhealthy, atau tidak terwire ke OpenCode. | `.opencode/skills/ocs-cocoindex-bootstrap` |
| **ocs-delegation-gate** | Mandatory skill-gating sebelum delegasi task/category. Mapping domain to skill, orchestration-first execution, domain mapping table. Untuk task multi-step di OCS. | `skills/ocs-delegation-gate` |
| **ocs-installer-copy-seo** | Buat copy high-conversion dan SEO-safe untuk public installer repo. Workflow per-section: hero, value proposition, social proof, feature outcomes, FAQ. | `skills/ocs-installer-copy-seo` |
| **ocs-lsp-bootstrap** | Install, wire, dan verifikasi language servers yang hilang di Windows, macOS, dan Linux. Ketika LSP tidak di PATH, diagnostics gagal, atau setup berubah. | `.opencode/skills/ocs-lsp-bootstrap` |
| **ocs-markdown-autofix** | Enforce markdown auto-fix plus verification workflow untuk plan/docs/communication files. Run targeted fix, verify, repo-level check jika perlu. | `skills/ocs-markdown-autofix` |
| **ocs-openai-multi-account** | Validasi dan safeguard runtime multi-account OpenAI di OCS: auth menu takeover, quota checks, token-state safety. Jangan restore stale accounts atau share token state Windows-WSL. | `skills/ocs-openai-multi-account` |
| **ocs-parallel-orchestration-grooming** | Orkestrasi parallel sub-agents dengan real-time monitoring, load balancing, dan strict context grooming. Untuk task dengan multiple independent workstreams. | `skills/ocs-parallel-orchestration-grooming` |
| **ocs-product-marketing-context** | Capture dan maintain buyer-facing product context untuk reuse oleh copy, SEO, dan onboarding skills. Shared source of truth untuk product positioning. | `.opencode/skills/ocs-product-marketing-context` |
| **ocs-programmatic-ai** | Panggil OpenCode secara programmatic dari Go atau scripts: structured prompts, machine-readable JSON output, safe automation patterns, session continuity. | `.opencode/skills/ocs-programmatic-ai` |
| **ocs-release-integrity** | Workflow release OCS dengan provenance, tarball parity checks, staging-safe publication rules. Build artifact, verify SHA256, sync buyer artifact. | `skills/ocs-release-integrity` |
| **ocs-runtime-validation** | Validasi runtime OCS end-to-end di WSL/local. Cek installer flow, plugin version, auth path behavior, quota checks, credential persistence. | `skills/ocs-runtime-validation` |
| **ocs-seo-audit** | Diagnosa SEO issues di technical product surfaces termasuk AI-search visibility. Audit terstruktur dengan prioritas fix, tanpa copywriting. | `.opencode/skills/ocs-seo-audit` |
| **ocs-technical-copy-seo** | Buat copy high-conversion dan SEO-safe untuk technical product surfaces: install, onboarding, setup, docs, landing pages. | `.opencode/skills/ocs-technical-copy-seo` |
| **ocs-test-regression-guard** | Behavior-proof skill: tambah atau perkuat targeted regression guards untuk feature integrations dan bug fixes. Turn important behavior claims menjadi executable guards. | `.opencode/skills/ocs-test-regression-guard` |

---

## Development Workflow & Productivity

Skill untuk workflow development umum, git, browser automation, code
review, dan pemeliharaan konteks.

| Skill | Deskripsi | Sumber |
| ------- | ----------- | -------- |
| **ai-slop-remover** | Hapus AI-generated code smells dari satu file sambil mempertahankan fungsionalitas. Deteksi komentar berlebihan, over-defensive code, spaghetti nesting. Untuk multiple files, panggil parallel per file. | Built-in (runtime) |
| **context-grooming** | Jaga context agent tetap lean dan recoverable selama long-running atau multi-step tasks. Dekomposisi goals, manage context growth, verifikasi sebelum close. | `.agents/skills/context-grooming` |
| **dev-browser** | Browser automation dengan persistent page state. Navigasi, klik, isi form, screenshot, scraping data. Untuk automation workflow browser apapun. | Built-in (runtime) |
| **find-skills** | Bantu user menemukan dan install agent skills dari ekosistem open agent skills. Ketika user bertanya "how do I do X", "find a skill for X", atau ingin extends capabilities. | `.agents/skills/find-skills` |
| **gemini-api-dev** | Bangun aplikasi dengan Gemini models dan Gemini API. Multimodal content (text, images, audio, video), function calling, structured outputs, model selection. SDK: Python, JS/TS, Java, Go. | `.agents/skills/gemini-api-dev` |
| **git-master** | Operasi git: atomic commits, rebase/squash, history search (blame, bisect, log -S). Commit architect, rebase surgeon, history archaeologist. Wajib dipakai untuk SEMUA operasi git. | Built-in (runtime) |
| **review-work** | Post-implementation review orchestrator. Luncurkan 5 parallel sub-agents (goal verification, QA execution, code quality, security, context mining). Semua harus pass. | Built-in (runtime) |

---

## Deprecated — Gunakan Pengganti Berikut

Skill lama yang dipertahankan untuk backward compatibility. Jangan
gunakan untuk task baru.

| Skill (Deprecated) | Digantikan Oleh | Sumber |
| --------------------- | ----------------- | -------- |
| **installer-copy-seo** | `ocs-installer-copy-seo` | `.agents/skills/installer-copy-seo` |
| **markdown-autofix** | `ocs-markdown-autofix` | `.agents/skills/markdown-autofix` |
| **runtime-validation** | `ocs-runtime-validation` | `.agents/skills/runtime-validation` |

---

## Catatan Pemeliharaan

**Sumber registri (precedence):**

1. **Primary** — `C:\Users\faizz\.config\opencode\skills` (kanonik, 10 skill)
2. **Secondary** —
   `C:\Users\faizz\.config\opencode\.opencode\skills` (7 skill unik,
   tambahan)
3. **Cross-client** —
   `C:\Users\faizz\.agents\skills` (6 skill unik, termasuk 3 deprecated)
4. **Built-in** — Terdaftar langsung di runtime OpenCode (4 skill)

**Aturan deduplikasi:** Skill dari registri dengan precedence lebih
tinggi menang. Nama duplikat dari registri lower-precedence tidak
dimasukkan. Skill unik dari secondary/cross-client ditambahkan ke
daftar final. Skill deprecated tetap dicantumkan dengan mapping ke
penggantinya.

### Total skill unik dalam katalog ini: 27

- 10 primary + 7 secondary (unik) + 6 cross-client (unik) + 4 built-in = 27
- 3 di antaranya ditandai deprecated

**Pembaruan terakhir:** 2026-07-23

## Audit Trail — Upstream PR Integration

Setiap PR dari upstream (decolua/9router) diaudit untuk kelayakan integrasi
sebelum digabung. Hasil audit disimpan di `.sisyphus/audits/`.

| PR | SHA | Topik | Berkas Audit |
|----|-----|-------|-------------|
| #2796 | 3a668524bb | fix(codex): strip content from additional_tools passthrough | `.sisyphus/audits/pr-2796-additional-tools.md` |
| #2794 | 660552583f | fix(usage): record exact embedding tokens | `.sisyphus/audits/pr-2794-embedding-tokens.md` |
| #2793 | b9b1fee1f2 | feat(combo): expose route attribution | `.sisyphus/audits/pr-2793-route-attribution.md` |
| #2792 | 72e7a54ccf | fix: recover Jina Reader after transient errors | `.sisyphus/audits/pr-2792-jina-reader.md` |
| #2789 | 2446f323ec | fix(kiro): normalize dashboard thinking intensity models | `.sisyphus/audits/pr-2789-kiro-thinking.md` |
| #2787 | 94eaf25b56 | fix(codex): preserve GPT-5.6 max reasoning | `.sisyphus/audits/pr-2787-gpt56-max.md` |
| #2786 | f3705be229 | feat(v1/models): add OpenCode and OpenAI-compatible provider model resolution | `.sisyphus/audits/pr-2786-v1-models.md` |
| #2784 | 08edf14df5 | fix: fail over on network connection errors | `.sisyphus/audits/pr-2784-failover.md` |
| #2783 | 0d2a3bb454 | fix(chatCore): unwrap ```json fences when the client asked for JSON | `.sisyphus/audits/pr-2783-json-fences.md` |
