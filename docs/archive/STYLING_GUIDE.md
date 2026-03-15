# Styling Guide & Design System

> **Frozen at MVP v1.0.0** — This document reflects the shipped implementation.

## Design Philosophy

Inspired by **Visual Studio Code** — A professional, developer-focused interface that prioritizes clarity, efficiency, and accessibility. The design emphasizes:

- **Dark Theme** - Reduces eye strain during extended work sessions
- **Semantic Color** - Colors convey meaning (blue = action, red = error, green = success)
- **Grid-Based Layout** - Consistent spacing and alignment
- **High Contrast** - Text readable on all backgrounds (WCAG AA)
- **Subtle Interactions** - Hover/focus states are present but not distracting
- **Icon Integration** - Visual indicators complement text
- **Keyboard Navigation** - All controls accessible without mouse

---

## Color Palette

Color values inspired by VS Code's One Dark Pro theme, adapted for clarity.

### Core Colors

```css
/* Backgrounds & Surfaces */
--bg: #1e1e1e;                    /* Editor background */
--surface: #252526;               /* Sidebar, secondary surfaces */
--surface-2: #2d2d30;             /* Elevated, hover states */
--surface-3: #3e3e42;             /* Selected, focused states */

/* Text */
--text: #d4d4d4;                  /* Primary text */
--text-secondary: #cccccc;        /* Readable but less important */
--muted: #858585;                 /* Disabled, hints, timestamps */
--text-link: #9cdcfe;             /* Links (lighter blue) */

/* Semantic Colors */
--accent: #007acc;                /* Primary action (VS Code blue) */
--success: #4ec9b0;               /* Success, valid (teal) */
--warning: #dcdcaa;               /* Warnings (gold) */
--error: #f48771;                 /* Errors, delete (coral red) */
--info: #9cdcfe;                  /* Info messages (light blue) */

/* Borders & Dividers */
--border: #3e3e42;                /* Subtle borders, dividers */
--border-focus: #007acc;          /* Focus ring around interactive elements */
```

### Color Application Reference

| Element | Color | Usage |
|---|---|---|
| Page/editor background | `#1e1e1e` | Main workspace |
| Sidebar/secondary surface | `#252526` | Left panels, context areas |
| Elevated surface | `#2d2d30` | Hover, dropdown, modals |
| Focus/selected | `#3e3e42` | Active tab, selected item |
| Primary text | `#d4d4d4` | Body text, labels |
| Secondary text | `#cccccc` | Subtle info |
| Muted text | `#858585` | Disabled state, timestamps, hints |
| Primary action | `#007acc` | Buttons, active indicators, hover |
| Success | `#4ec9b0` | Completion, valid state |
| Warning | `#dcdcaa` | Cautions, warnings |
| Error | `#f48771` | Errors, failures, stderr |
| Subtle border | `#3e3e42` | Dividers, card borders |
| Focus border | `#007acc` | Keyboard focus indicators (2px) |

---

## Typography

### Font Families

```css
/* User Interface - System fonts ensure native feel across platforms */
--font-family-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", sans-serif;

/* Editor & Terminal - Monospace for code consistency */
--font-family-mono: "Consolas", "Monaco", "Courier New", monospace;
```

### Font Sizes

Follows VS Code's typographic scale:

```css
--size-xs: 11px;    /* Code folding, very small UI elements */
--size-sm: 12px;    /* Monospace code, timestamps */
--size-base: 13px;  /* Standard UI text (VS Code default) */
--size-md: 14px;    /* Large UI, readable prose */
--size-lg: 16px;    /* Headings, emphasis */
--size-xl: 18px;    /* Section headings */
--size-xxl: 24px;   /* Page title */
```

**Note:** `13px` is VS Code's standard UI font size. It provides excellent readability at typical viewing distances.

### Font Weights & Usage

- **Regular (400):** Body text, descriptions, code
- **Medium (500):** Tab titles, button labels, secondary headings
- **Semi-bold (600):** Primary headings, active state labels
- **Bold (700):** Page titles, major section headings

### Line Heights

- Code/terminal: `1.5` (readable monospace, preserves context)
- UI labels: `1.4` (compact, matches VS Code)
- Body text: `1.6` (readable prose)
- Headings: `1.3` (tighter leading for emphasis)

### Example Usage

```css
body {
  font-family: var(--font-family-ui);
  font-size: var(--size-base);      /* 13px */
  font-weight: 400;
  line-height: 1.4;
  color: var(--text);
}

h1 {
  font-size: var(--size-xxl);       /* 24px */
  font-weight: 600;
  line-height: 1.3;
  color: var(--text);
}

code,
.terminal {
  font-family: var(--font-family-mono);
  font-size: var(--size-sm);        /* 12px */
  line-height: 1.5;
}
```

---

## Spacing System

VS Code uses an 8px base unit grid, adapted for web:

### Unit Scale

```css
--space-xs: 4px;      /* Tight spacing between inline elements */
--space-sm: 8px;      /* Compact padding, item gaps */
--space-md: 12px;     /* Standard padding, section gaps */
--space-lg: 16px;     /* Card padding, major spacing */
--space-xl: 20px;     /* Section separators */
--space-2xl: 32px;    /* Large section margins */
```

### Application

- **Component padding:** `--space-md` (12px) standard
- **Button padding:** `8px 16px` (vertical x horizontal)
- **Card margins:** `--space-md` (12px) between cards
- **Section margins:** `--space-xl` to `--space-2xl`
- **Border radius:** `4px` (subtle, matches VS Code)

### Vertical Rhythm

Maintain consistent line height (22px vertical unit based on 13px font + 1.4 line-height):

```css
.tab {
  padding: 8px 12px;       /* Compact vertical control */
  line-height: 22px;       /* Matches rhythm */
}

.card {
  padding: var(--space-lg);
  margin-bottom: var(--space-md);
}

.section-title {
  margin-top: var(--space-xl);
  margin-bottom: var(--space-md);
}
```

---

## Components

### Button Component

Two primary button styles (matching VS Code):

#### Primary Button (Primary Action)

```css
button,
.btn {
  font-family: var(--font-family-ui);
  font-size: var(--size-base);   /* 13px */
  font-weight: 500;
  padding: 8px 16px;
  margin: 0;
  border: 1px solid transparent;
  border-radius: 4px;
  background-color: var(--accent);
  color: #fff;                    /* White text on blue bg */
  cursor: pointer;
  transition: all 150ms ease;     /* Faster than 200ms */
}

button:hover:not(:disabled) {
  background-color: #1177bb;      /* Slightly darkened blue */
}

button:active:not(:disabled) {
  background-color: #0e5c96;      /* Pressed state */
}

button:focus:not(:disabled) {
  outline: 1px solid var(--border-focus);
  outline-offset: 2px;
}

button:disabled {
  background-color: var(--surface-2);
  color: var(--muted);
  cursor: not-allowed;
  opacity: 0.5;
}
```

#### Secondary Button (Alternative Action)

```css
.btn-secondary {
  background-color: transparent;
  color: var(--text);
  border: 1px solid var(--border);
}

.btn-secondary:hover:not(:disabled) {
  background-color: var(--surface-2);
  border-color: var(--accent);
  color: var(--accent);
}
```

#### Danger Button (Destructive Action)

```css
.btn-danger {
  background-color: var(--error);
  color: #fff;
}

.btn-danger:hover:not(:disabled) {
  background-color: #d84a38;
}
```

#### Button Sizes

```css
.btn-sm {
  padding: 4px 12px;
  font-size: var(--size-sm);     /* 12px */
}

.btn-md {
  padding: 8px 16px;             /* Standard */
}

.btn-lg {
  padding: 12px 20px;
  font-size: var(--size-md);     /* 14px */
}
```

---

### Card / Panel Component

Cards are containers for grouped content (script cards, panels).

```css
.card {
  background-color: var(--color-bg-secondary);
  border-radius: 8px;
  padding: var(--space-md);
  border: 1px solid var(--color-bg-tertiary);
  transition: all 200ms ease;
}

.card:hover {
  border-color: var(--color-accent);
  box-shadow: 0 4px 12px rgba(0, 212, 255, 0.1);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-md);
  padding-bottom: var(--space-md);
  border-bottom: 1px solid var(--color-bg-tertiary);
}

.card-title {
  font-size: var(--size-font-lg);
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.card-body {
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.card-footer {
  margin-top: var(--space-md);
  padding-top: var(--space-md);
  border-top: 1px solid var(--color-bg-tertiary);
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
}
```

---

### Terminal Component

Terminal display for script output (matching VS Code's integrated terminal).

```css
.terminal,
pre[class*="terminal-"] {
  background-color: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: var(--space-md);
  font-family: var(--font-family-mono);
  font-size: 13px;
  line-height: 1.5;
  color: #e0e0e0;
  max-height: 500px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.terminal-scroll::-webkit-scrollbar {
  width: 8px;
}

.terminal-scroll::-webkit-scrollbar-track {
  background: var(--color-bg-secondary);
}

.terminal-scroll::-webkit-scrollbar-thumb {
  background: var(--color-bg-tertiary);
  border-radius: 4px;
}

.terminal-line {
  display: flex;
  gap: var(--space-sm);
  margin-bottom: 4px;
}

.terminal-line .timestamp {
  color: var(--color-text-muted);
  flex-shrink: 0;
  min-width: 100px;
}

.terminal-line .content {
  color: var(--color-text-primary);
  flex: 1;
}

.terminal-line.terminal-error .content {
  color: var(--color-error);
}

.terminal-line.terminal-success .content {
  color: var(--color-success);
}

.terminal-line.terminal-warning .content {
  color: var(--color-warning);
}
```

---

### Form Elements

Input fields styled in VS Code convention.

```css
input[type="text"],
input[type="email"],
input[type="search"],
textarea,
select {
  background-color: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: var(--space-sm) var(--space-md);
  font-family: inherit;
  font-size: var(--size-font-base);
  transition: border-color 200ms ease;
}

input:focus,
textarea:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(0, 212, 255, 0.1);
}

input::placeholder,
textarea::placeholder {
  color: var(--color-text-muted);
}

input:disabled,
textarea:disabled {
  background-color: var(--color-bg-tertiary);
  color: var(--color-text-muted);
  cursor: not-allowed;
}
```

---

## Layout Patterns

Layouts follow VS Code's grid system using 8px base units.

### Script Grid (Script List)

```css
.scripts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-lg);
  padding: var(--space-lg);
}
```

### Toolbar / Button Group

```css
.toolbar,
.button-group {
  display: flex;
  gap: var(--space-md);
  justify-content: flex-end;
  align-items: center;
}

.toolbar {
  padding: var(--space-md);
  border-top: 1px solid var(--border);
  background-color: var(--surface);
}
```

### Tab Navigation

```css
.tab-bar {
  display: flex;
  gap: 0;
  padding: 0;
  background-color: var(--surface);
  border-bottom: 1px solid var(--border);
}

.tab {
  flex: 0 1 auto;
  padding: 8px 16px;
  background: transparent;
  border: 1px solid transparent;
  border-bottom: 2px solid transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--size-base);
  font-weight: 500;
  transition: all 150ms ease;
}

.tab:hover {
  background-color: var(--surface-2);
  color: var(--text);
}

.tab.active {
  color: var(--text);
  border-bottom-color: var(--accent);
  background-color: var(--bg);
}
```

---

## Interactions & Focus Indicators

### Focus Visible (Keyboard Navigation)

All interactive elements must have visible focus indicators for accessibility.

```css
/* Focus should be visible for keyboard users */
button:focus-visible,
input:focus-visible,
a:focus-visible,
[tabindex]:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* Explicit focus ring for better visibility */
*:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 2px;
}
```

### Hover & Active States

Subtle transitions match VS Code's responsive-but-quiet interaction model:

```css
/* Fast transitions (UI feedback - 150ms) */
button,
.card,
input {
  transition: all 150ms ease;
}

/* Links */
a {
  color: var(--text-link);
  text-decoration: none;
  transition: color 150ms ease;
}

a:hover {
  color: var(--accent);
  text-decoration: underline;
}

/* Card hover */
.card:hover {
  background-color: var(--surface-2);
  border-color: var(--accent);
}

/* Tab hover */
.tab:hover {
  background-color: var(--surface-2);
}
```

---

## Accessibility Considerations

VS Code's design prioritizes inclusive, accessible interfaces:

- **Color contrast:** All text meets WCAG AA (4.5:1 minimum for body text)
- **Focus indicators:** On every interactive element, 2px outline
- **Keyboard navigation:** Tab order logical, skip links provided
- **Icon + text:** Icons always accompanied by text labels
- **Motion:** Transitions are 150ms max (no excessive animation)
- **Screen readers:** ARIA labels on complex controls

---

## Dark Theme Variables (Complete Reference)

All CSS custom properties used in the design system:

```css
:root {
  /* Backgrounds */
  --bg: #1e1e1e;
  --surface: #252526;
  --surface-2: #2d2d30;
  --surface-3: #3e3e42;
  
  /* Text */
  --text: #d4d4d4;
  --text-secondary: #cccccc;
  --muted: #858585;
  --text-link: #9cdcfe;
  
  /* Semantic */
  --accent: #007acc;
  --success: #4ec9b0;
  --warning: #dcdcaa;
  --error: #f48771;
  --info: #9cdcfe;
  
  /* Borders */
  --border: #3e3e42;
  --border-focus: #007acc;
  
  /* Fonts */
  --font-family-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", sans-serif;
  --font-family-mono: "Consolas", "Monaco", "Courier New", monospace;
  
  /* Sizes */
  --size-xs: 11px;
  --size-sm: 12px;
  --size-base: 13px;
  --size-md: 14px;
  --size-lg: 16px;
  --size-xl: 18px;
  --size-xxl: 24px;
  
  /* Spacing (8px base grid) */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 12px;
  --space-lg: 16px;
  --space-xl: 20px;
  --space-2xl: 32px;
}
```

### Focus Indicators
```css
*:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
```

### Keyboard Navigation
- Tab order logical and visible
- All buttons keyboard accessible
- Enter/Space activate buttons
- Arrow keys for navigation

---

## Dark Theme CSS Variables

Complete variable set for easy theme switching:

```css
:root {
  /* Backgrounds */
  --color-bg-primary: #1a1a1a;
  --color-bg-secondary: #2a2a2a;
  --color-bg-tertiary: #3a3a3a;
  
  /* Text */
  --color-text-primary: #e0e0e0;
  --color-text-secondary: #a0a0a0;
  --color-text-muted: #707070;
  
  /* Semantic */
  --color-accent: #00d4ff;
  --color-success: #51cf66;
  --color-error: #ff6b6b;
  --color-warning: #ffd700;
  --color-info: #66b2ff;
  
  /* Fonts */
  --font-family-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-family-mono: "Courier New", Monaco, monospace;
  
  /* Sizes */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-2xl: 48px;
  
  --size-font-xs: 12px;
  --size-font-sm: 13px;
  --size-font-base: 14px;
  --size-font-lg: 16px;
  --size-font-xl: 18px;
  --size-font-xxl: 24px;
  
  --size-radius: 4px;
  --size-radius-lg: 8px;
}
```

---

## Example: Script Card

```html
<div class="script-card card">
  <div class="card-header">
    <div>
      <h3 class="card-title">backup-database</h3>
      <p class="script-language">bash</p>
    </div>
  </div>
  
  <p class="card-body">
    Backs up the production database to cloud storage
  </p>
  
  <div class="card-footer">
    <button class="btn btn-primary">▶ Run Script</button>
  </div>
</div>
```

---

**Design System Version:** 1.0
**Last Updated:** March 13, 2026
**Theme:** Dark (Light theme available in Phase 2)
