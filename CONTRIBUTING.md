# Contributing to Orvix Desktop

Thank you for your interest in contributing to **Orvix Desktop**! Orvix is an open-source, sovereign multi-engine AI workspace built for developers, architects, and creators. We welcome contributions of all levels, from documentation fixes to new agent tools and multi-engine providers.

---

## 🧭 Code of Conduct

We are committed to providing a friendly, welcoming, and inclusive environment for everyone. Please be respectful and constructive in all discussions, pull requests, and issue reports.

---

## 🛠️ Development Setup

### Prerequisites
* **Node.js**: `v20.x` or higher
* **npm**: `v9.x` or higher
* **Git**: Installed and configured

### Installation
1. **Fork the repository** on GitHub.
2. **Clone your fork**:
   ```bash
   git clone https://github.com/<your-username>/Orvix.git
   cd Orvix
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Start the local development server**:
   ```bash
   npm run dev
   ```
5. **Launch with Electron (Desktop Mode)**:
   ```bash
   npm run electron:dev
   ```

---

## 🌿 Contribution Workflow

1. **Create a branch**:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/issue-description
   ```
2. **Make your changes**:
   * Keep changes focused and atomic.
   * Ensure TypeScript types are complete with no `any` leaks.
3. **Run build and typechecks**:
   ```bash
   npm run build
   ```
4. **Commit your changes**:
   Follow conventional commits:
   * `feat: add new tool routing provider`
   * `fix: prevent race condition in agent turn compaction`
   * `docs: update installation instructions`
5. **Push and open a Pull Request**:
   ```bash
   git push origin feature/your-feature-name
   ```
   Open a PR against the `main` branch with a clear summary of changes and before/after screenshots if modifying the UI.

---

## 💡 Areas Where You Can Help (`good first issue`)

* **New Engine Providers**: Adding integrations for local runners like Ollama, LM Studio, or vLLM.
* **UI Themes & Visual Polish**: Enhancing glassmorphism styling, animations, or keyboard shortcuts.
* **Agent Tools**: Writing additional custom tools for `apply_patch_batch`, database inspection, or Git worktrees.
* **Documentation & Guides**: Adding tutorials, architecture explanations, or setup walkthroughs.

---

## 🔒 Security & Privacy

If you discover a security vulnerability or secret leakage risk in Orvix, please **do not open a public issue**. Report it privately via [GitHub Security Advisories](https://github.com/shahzaib2025/Orvix/security/advisories) or contact the maintainers directly.
