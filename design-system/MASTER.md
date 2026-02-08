# Simply Sats Design System

> Single source of truth for all UI decisions. Codifies existing patterns, fills gaps, and aligns to professional standards.

**Stack:** React 19 + Tailwind CSS 4 + Tauri 2
**Tokens:** `src/styles/design-tokens.css`
**Styles:** `src/App.css`

---

## 1. Visual Identity

### Brand Personality

- **Tone:** Professional, trustworthy, minimal, secure
- **Style:** Dark mode (OLED-optimized), minimal and direct
- **Mood:** Fintech precision meets crypto confidence -- amber-gold warmth on deep dark surfaces

---

## 2. Color System

### Backgrounds (warm dark, blue-violet undertone)

| Token             | Value     | Use                  |
|-------------------|-----------|----------------------|
| `--bg-base`       | `#0c0c0f` | App background       |
| `--bg-surface-1`  | `#13131a` | Sidebar, nav         |
| `--bg-surface-2`  | `#1a1a24` | Cards, modals        |
| `--bg-surface-3`  | `#22222e` | Elevated surfaces    |
| `--bg-surface-4`  | `#2a2a38` | Highest elevation    |

### Accent -- Amber/Gold (trust, value, Bitcoin identity)

| Token               | Value                                      |
|----------------------|--------------------------------------------|
| `--accent-light`     | `#fbbf24`                                  |
| `--accent`           | `#f59e0b`                                  |
| `--accent-dark`      | `#d97706`                                  |
| `--accent-glow`      | `rgba(245, 158, 11, 0.15)`                |
| `--accent-subtle`    | `rgba(245, 158, 11, 0.08)`                |
| `--accent-gradient`  | `linear-gradient(135deg, #fbbf24 0%, #f59e0b 40%, #d97706 100%)` |

### Secondary -- Indigo (technology, BRC-100 protocol)

| Token               | Value                        |
|----------------------|------------------------------|
| `--secondary-light`  | `#818cf8`                    |
| `--secondary`        | `#6366f1`                    |
| `--secondary-dark`   | `#4f46e5`                    |
| `--secondary-subtle` | `rgba(99, 102, 241, 0.08)`   |
| `--secondary-glow`   | `rgba(99, 102, 241, 0.12)`   |

### Text Hierarchy

| Token              | Value     | Use                           |
|--------------------|-----------|-------------------------------|
| `--text-primary`   | `#f0f0f5` | Main content, headings        |
| `--text-secondary` | `#9898a8` | Supporting text, labels       |
| `--text-tertiary`  | `#5c5c6e` | Timestamps, captions          |
| `--text-muted`     | `#3d3d4e` | Disabled, placeholders        |

### Status Colors

| Status  | Color     | Background                     | Border                          | Use                              |
|---------|-----------|--------------------------------|---------------------------------|----------------------------------|
| Success | `#34d399` | `rgba(52, 211, 153, 0.10)`     | `rgba(52, 211, 153, 0.25)`      | Confirmed tx, valid addresses    |
| Warning | `#fbbf24` | `rgba(251, 191, 36, 0.10)`     | `rgba(251, 191, 36, 0.25)`      | Pending, caution                 |
| Error   | `#f87171` | `rgba(248, 113, 113, 0.10)`    | `rgba(248, 113, 113, 0.25)`     | Failed, invalid                  |
| Info    | `#818cf8` | `rgba(129, 140, 248, 0.10)`    | `rgba(129, 140, 248, 0.25)`     | Informational, BRC-100           |

### Interactive State Tokens

| Token              | Value                                                          | Use                  |
|--------------------|----------------------------------------------------------------|----------------------|
| `--overlay-bg`     | `rgba(0, 0, 0, 0.75)`                                         | Modal backdrop       |
| `--hover-overlay`  | `rgba(255, 255, 255, 0.04)`                                   | Hover state overlay  |
| `--active-overlay` | `rgba(255, 255, 255, 0.08)`                                   | Active/pressed state |
| `--focus-ring`     | `0 0 0 2px var(--bg-base), 0 0 0 4px var(--accent)`           | Keyboard focus ring  |
| `--skeleton-base`  | `var(--bg-surface-2)`                                          | Skeleton loading bg  |
| `--skeleton-shine` | `var(--bg-surface-3)`                                          | Skeleton shimmer     |

### Contrast Ratios (WCAG Verified)

| Combination                                    | Ratio    | Level    |
|------------------------------------------------|----------|----------|
| `--text-primary` on `--bg-base`                | **14.8:1** | AAA    |
| `--text-secondary` on `--bg-base`              | **6.2:1**  | AA     |
| `--text-tertiary` on `--bg-base`               | **3.1:1**  | Decorative only |
| `--accent` on `--bg-base`                      | **8.4:1**  | AAA    |

> `--text-tertiary` must NOT be used for essential text. Use only for decorative elements (timestamps, captions with redundant info).

---

## 3. Typography

### Fonts

- **Sans:** `Inter` -- clean, professional, excellent tabular numbers
- **Mono:** `JetBrains Mono` -- developer trust, perfect for addresses/amounts

Both installed via `@fontsource` (no external requests -- ideal for desktop app).

### Type Scale

| Token                    | Size  | Weight | Use                          |
|--------------------------|-------|--------|------------------------------|
| `--type-balance-size`    | 40px  | 700    | Primary balance display      |
| `--type-h1-size`         | 28px  | 700    | Modal titles                 |
| `--type-h2-size`         | 22px  | 600    | Section headers              |
| `--type-h3-size`         | 17px  | 600    | Card titles                  |
| `--type-body-size`       | 14px  | 400    | Body text, labels            |
| `--type-caption-size`    | 12px  | 500    | Timestamps, secondary info   |
| `--type-micro-size`      | 11px  | 500    | Badges, status indicators    |

### Rules

- Body text line-height: `1.5`
- Mono font for: addresses, amounts, txids, block heights
- Tabular nums (`font-variant-numeric: tabular-nums`) for all numeric displays
- Letter-spacing: negative for headings, 0 for body

---

## 4. Icons -- Lucide React

Using `lucide-react` v0.563.

### Rules

- Default size: `20px` (`--icon-md`) for inline, `16px` for buttons, `24px` for nav
- Stroke width: `1.75` (default -- thinner feels more premium)
- Color: inherit from parent text color
- Never use emojis as UI icons
- Always add `aria-hidden="true"` when icon is decorative (next to text label)

### Size Tokens

| Token        | Size  | Use                    |
|--------------|-------|------------------------|
| `--icon-xs`  | 14px  | Small inline           |
| `--icon-sm`  | 16px  | Buttons                |
| `--icon-md`  | 20px  | Default inline         |
| `--icon-lg`  | 24px  | Navigation             |
| `--icon-xl`  | 32px  | Feature icons          |
| `--icon-2xl` | 48px  | Hero/splash            |

---

## 5. Spacing (4px Grid)

| Token        | Value | Use                           |
|--------------|-------|-------------------------------|
| `--space-1`  | 4px   | Tight gaps                    |
| `--space-2`  | 8px   | Between related elements      |
| `--space-3`  | 12px  | Component internal padding    |
| `--space-4`  | 16px  | Standard padding, page margin |
| `--space-5`  | 20px  | Comfortable spacing           |
| `--space-6`  | 24px  | Between sections              |
| `--space-7`  | 32px  | Large section gaps            |
| `--space-8`  | 40px  | Page section dividers         |
| `--space-10` | 48px  | Hero spacing                  |
| `--space-12` | 64px  | Maximum spacing               |

### Usage Rules

- Component internal padding: `--space-3` to `--space-4`
- Between related elements: `--space-2`
- Between sections: `--space-6` to `--space-8`
- Page margins: `--space-4`

---

## 6. Border Radius

| Token          | Size    | Use                              |
|----------------|---------|----------------------------------|
| `--radius-xs`  | 6px     | Small badges, status dots        |
| `--radius-sm`  | 8px     | Buttons, icon buttons, chips     |
| `--radius-md`  | 10px    | Inputs, small cards              |
| `--radius-lg`  | 14px    | Cards, modals, dropdowns         |
| `--radius-xl`  | 18px    | Large panels                     |
| `--radius-2xl` | 24px    | Extra large panels               |
| `--radius-full`| 9999px  | Pills, avatars, status badges    |

---

## 7. Shadows

Multi-layer shadows for realistic depth.

| Token          | Use                        |
|----------------|----------------------------|
| `--shadow-xs`  | Subtle lift                |
| `--shadow-sm`  | Cards at rest              |
| `--shadow-md`  | Hover state cards          |
| `--shadow-lg`  | Dropdowns, popovers       |
| `--shadow-xl`  | Modals                     |
| `--shadow-glow`| Amber accent glow (brand) |

---

## 8. Component Patterns

### Buttons

Four tiers defined as `@utility` classes in `design-tokens.css`:

| Variant     | Class           | Use                                    |
|-------------|-----------------|----------------------------------------|
| Primary     | `btn-primary`   | Main actions: Send, Confirm, Create    |
| Secondary   | `btn-secondary` | Secondary: Cancel, Back, View Details  |
| Ghost       | `btn-ghost`     | Tertiary: Close, Skip, minor toggles  |
| Danger      | `btn-danger`    | Destructive: Delete, Clear Data        |

#### Rules

- All buttons: `cursor: pointer`, `min-height: 44px` (touch target)
- Loading state: `disabled={loading}` + spinner replacing text
- Active state: `transform: scale(0.97)` (subtle press)
- Focus state: `--focus-ring` (2px accent ring with base gap)
- Never disable without visual explanation

### Cards

Use `card` utility class.

- Background: `--bg-surface-2`
- Border: `1px solid var(--border)`
- Radius: `--radius-lg`
- If clickable: `cursor: pointer` + hover border `--border-light` + `--hover-overlay`

### Inputs

Use `input-field` utility class.

- Focus: border `--border-focus` + subtle glow
- Error: border `--border-error` + `aria-invalid="true"`
- Disabled: `opacity: var(--opacity-disabled)`
- Labels: always use `<label htmlFor="id">` paired with `<input id="id">`

### Modals

- Overlay: `--overlay-bg`
- Container: `--bg-surface-2`, `--radius-xl`, `--shadow-xl`
- Animation: `modalIn` keyframe
- Focus trap: `useFocusTrap` hook
- Close: Escape key via `useKeyboardNav`
- Title: use `aria-labelledby`

### Toast Notifications

- Position: bottom-center
- Auto-dismiss: 4s (success/info), 6s (warning/error)
- Background: status color bg
- `role="status"` + `aria-live="polite"` for screen readers

---

## 9. Animation & Motion

### Timing

| Token                 | Duration | Use                              |
|-----------------------|----------|----------------------------------|
| `--duration-instant`  | 75ms     | Button press feedback            |
| `--duration-fast`     | 150ms    | Hover states, toggles            |
| `--duration-normal`   | 200ms    | Input focus, card transitions    |
| `--duration-slow`     | 300ms    | Modal open/close, page nav       |
| `--duration-slower`   | 450ms    | Complex animations, onboarding   |

### Easing

| Token            | Curve                              | Use                            |
|------------------|------------------------------------|--------------------------------|
| `--ease-out`     | `cubic-bezier(0.33, 1, 0.68, 1)`  | Elements entering              |
| `--ease-in`      | `cubic-bezier(0.32, 0, 0.67, 0)`  | Elements exiting               |
| `--ease-in-out`  | `cubic-bezier(0.65, 0, 0.35, 1)`  | Continuous motion              |
| `--ease-spring`  | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Playful (toggle, success)    |

### Motion Rules

- Use `transform` and `opacity` only for animations (GPU-accelerated)
- Never animate `width`, `height`, `top`, `left` (layout thrashing)
- Respect `prefers-reduced-motion` (see Accessibility section)

### Loading States

| State             | Component       | Behavior                           |
|-------------------|-----------------|------------------------------------|
| Initial load      | `Skeleton`      | Pulse animation on card shapes     |
| Data refresh      | Spinner icon    | Rotating sync icon in header       |
| Transaction send  | Button spinner  | Disable button, show spinner       |
| Sync in progress  | Status dot      | Pulse animation on green dot       |

---

## 10. Accessibility (WCAG 2.1 AA)

### Color Contrast

- All body text must meet **4.5:1** contrast ratio (WCAG AA)
- Large text (18px+ or 14px+ bold) must meet **3:1**
- `--text-tertiary` is decorative only -- never use for essential content

### Form Labels

Every form input must have a semantically associated label:

```tsx
<label htmlFor="send-address" className="form-label">To</label>
<input id="send-address" type="text" />
```

### Error States

Color alone must not indicate errors. Always include:
- `aria-invalid="true"` on the input
- Error icon alongside red border
- `aria-describedby` linking to error message element
- `role="alert"` on error message container

### Focus Management

- All interactive elements have visible focus ring: `--focus-ring`
- Modals trap focus with `useFocusTrap`
- Escape key closes modals via `useKeyboardNav`

### Live Regions

- Balance display: `aria-live="polite"` for value changes
- Toast notifications: `role="status"` + `aria-live="polite"`
- Error toasts: `role="alert"` + `aria-live="assertive"`
- Loading states: `aria-busy="true"`

### Keyboard Navigation

| Key           | Action                     |
|---------------|----------------------------|
| Tab           | Move focus forward         |
| Shift+Tab     | Move focus backward        |
| Enter/Space   | Activate button/link       |
| Escape        | Close modal/dropdown       |

### Reduced Motion

Users who prefer reduced motion get minimal animations:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### Screen Reader

- Modals: `role="dialog"` + `aria-labelledby`
- Disabled elements: `aria-disabled="true"` (not just `disabled`)
- Decorative icons: `aria-hidden="true"`
- Status changes: `aria-live="polite"`

---

## 11. Responsive Breakpoints

Simply Sats is a desktop-first Tauri app with resizable window.

| Breakpoint | Width     | Layout Adaptation                      |
|------------|-----------|----------------------------------------|
| Compact    | < 400px   | Stack buttons, hide secondary text     |
| Default    | 400-600px | Standard layout (primary target)       |
| Wide       | > 600px   | Show additional columns, expanded cards|

---

## 12. File Reference

| File                               | Purpose                              |
|------------------------------------|--------------------------------------|
| `src/styles/design-tokens.css`     | All CSS custom properties + utilities|
| `src/App.css`                      | Component styles                     |
| `src/components/shared/Modal.tsx`  | Base modal component                 |
| `src/components/shared/Toast.tsx`  | Toast notification component         |
| `src/components/shared/Skeleton.tsx`| Loading skeleton component          |
| `src/components/shared/SkipLink.tsx`| Skip navigation link                |
| `src/components/shared/ScreenReaderAnnounce.tsx` | SR announcements    |
| `src/hooks/useFocusTrap.ts`        | Focus trap for modals                |
| `src/hooks/useKeyboardNav.ts`      | Keyboard navigation (Escape, etc.)   |
