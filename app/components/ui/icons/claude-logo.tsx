export default function ClaudeLogo({
  width = '24',
  height = '24',
  style,
}: {
  width?: string
  height?: string
  style?: React.CSSProperties
}) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
    >
      <path
        d="M12 2C12 2 12.7 5.5 14.1 7.9C15.5 10.3 19 12 19 12C19 12 15.5 13.7 14.1 16.1C12.7 18.5 12 22 12 22C12 22 11.3 18.5 9.9 16.1C8.5 13.7 5 12 5 12C5 12 8.5 10.3 9.9 7.9C11.3 5.5 12 2 12 2Z"
        fill="#D97706"
      />
    </svg>
  )
}
