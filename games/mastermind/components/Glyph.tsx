// Each colour's symbol, inside a 24×24 box: a circle, a square, a triangle, a
// diamond, a star, a cross and a heart.
export function Glyph({ color }: { color: number }) {
  switch (color) {
    case 0:
      return <circle cx="12" cy="12" r="6" />;
    case 1:
      return <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />;
    case 2:
      return <path d="M12 5 19.5 18.5h-15z" />;
    case 3:
      return <path d="M12 4 20 12 12 20 4 12z" />;
    case 4:
      return (
        <path d="M12 4.6 14.1 9.7 19.6 10.1 15.4 13.7 16.7 19.1 12 16.2 7.3 19.1 8.6 13.7 4.4 10.1 9.9 9.7z" />
      );
    case 5:
      return <path d="M9.6 5h4.8v4.6H19v4.8h-4.6V19H9.6v-4.6H5V9.6h4.6z" />;
    default:
      return <path d="M12 19.2 5.3 12.6a4 4 0 0 1 6.7-5.1 4 4 0 0 1 6.7 5.1z" />;
  }
}
