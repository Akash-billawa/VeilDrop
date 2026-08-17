# Contributing to VeilDrop

Thank you for your interest in contributing to VeilDrop.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/Akash-billawa/VeilDrop.git
cd VeilDrop

# Backend
cd backend
pip install -r requirements.txt
cp .env.example .env  # configure DATABASE_URL and SESSION_SECRET

# Frontend (no build step required)
cd ../frontend
```

## Running Tests

```bash
# Backend (100+ tests)
cd backend
python -m pytest -q

# Lint and type check
ruff check .
ruff format --check .
mypy app

# Frontend crypto tests
cd ../frontend
node tests/crypto.test.cjs

# WCAG audit
node tests/wcag-audit.cjs
```

## Code Style

- **Python:** Follow PEP 8. Lint with `ruff`, type check with `mypy`.
- **JavaScript:** No build step, vanilla ES6+. Run `node --check` on all files.
- **CSS:** Use design tokens from `tokens.css`. Maintain WCAG 2.2 AA contrast ratios.

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes with tests
3. Run the full test suite and lint checks
4. Open a PR with a clear description of the change
5. Ensure CI passes before requesting review

## Security

If you discover a security vulnerability, please see [SECURITY.md](SECURITY.md) for responsible disclosure instructions. Do not open a public issue for security vulnerabilities.
