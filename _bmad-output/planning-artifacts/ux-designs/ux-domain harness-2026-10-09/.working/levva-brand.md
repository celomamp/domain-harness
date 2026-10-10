# Levva brand extract — levva.io

Source: https://levva.io/ captured 2026-10-09. Values are computed styles from the live homepage. WordPress preset colors on `:root` that do not appear on the page are omitted.

## Surfaces

- Hero and chrome: `#000000`
- Near-black sections: `#0A0A0A`, `#101319`
- Cream content: `#FEFBE9`
- White: `#FFFFFF`, nav on light `#FAFAFA`
- Footer band: `#FBBF24`
- Header action fill: `#171717`

## Accent

- Primary gold button: `#FFC700` fill, `#000000` text, Sora 14px / 600, letter-spacing 0.46px, padding 8px 22px, radius 4px
- Amber used on the footer: `#FBBF24`
- Ghost on black: transparent, 1px white border, white Sora 14px / 600, radius 4px

## Type

Google Fonts loaded: Montserrat, Poppins, Roboto, Sora.

- H1: Poppins 52px / 400 / 67.6px, white on black
- H2: Sora 48px / 600–700, white on black or `#0A0A0A` on cream
- H3: Sora 36px / 700 or 22px / 700
- Hero body: Poppins 16px / 300, white
- Nav and buttons: Sora 14px / 400–600, `#171717` on light
- Fallback body stack: Readex Pro, system-ui
- Inputs: Sora 16px, `#0A0A0A` on `#FFFFFF`, 1px `#E5E5E5` border, radius 8px, padding 4px 12px, shadow `rgba(0,0,0,0.1) 0 1px 2px`

## Shape and depth

- Action radius 4px. Form radius 8px. No pills.
- Elevation is a 1px tinted shadow, not a stack of cards.
- Marketing sections pad 56–76px. Cream and black alternate. Gold is a fill, not a wash on body text.

## Not used on the live page

- `#737373` appears as a computed text color but fails 4.5:1 on `#FEFBE9`. Do not use it for panel body text.
- An older kit (`levva-ds`) documents `#FFC800` and Poppins. The live button is `#FFC700`. Follow the live site.
- MaxiBestOf GT Planar listing is a different Levva product.
