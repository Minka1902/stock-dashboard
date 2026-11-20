/**
 * The Signal mark: the diamond with a pulse through it (public/icons/logo.svg
 * is the same drawing on its app-icon tile). It takes `currentColor`, so it
 * follows the theme's accent wherever it sits. `size` is any CSS length
 * (a number is px); `tile` adds the dark rounded square of the app icon;
 * `title` makes it announce itself instead of being decorative.
 */
export default function Logo({ size = "1em", tile = false, title, className }) {
  return (
    <svg
      className={className}
      viewBox={tile ? "0 0 64 64" : "3 3 58 58"}
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      fill="none"
      stroke="currentColor"
      strokeWidth="5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {tile && <rect width="64" height="64" rx="14" fill="#1c1915" stroke="none" />}
      <path d="M32 9 55 32 32 55 9 32Z" />
      <path d="M6 33h15l5-11 7 21 6-14 3 4h16" />
    </svg>
  );
}
