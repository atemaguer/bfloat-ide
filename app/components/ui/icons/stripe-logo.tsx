export default function StripeLogo({
  width = "24",
  height = "24",
  style,
}: {
  width?: string
  height?: string
  style?: React.CSSProperties
}) {
  return (
    <svg width={width} height={height} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={style}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M3 4C3 3.44772 3.44772 3 4 3H20C20.5523 3 21 3.44772 21 4V20C21 20.5523 20.5523 21 20 21H4C3.44772 21 3 20.5523 3 20V4Z"
        fill="#635BFF"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M11.1 10.2C11.1 9.6 11.6 9.35 12.4 9.35C13.5 9.35 14.9 9.7 16 10.3V7.3C14.8 6.8 13.6 6.6 12.4 6.6C9.8 6.6 8.1 8 8.1 10.35C8.1 14.05 13.3 13.45 13.3 15.05C13.3 15.75 12.7 16 11.85 16C10.65 16 9.1 15.5 7.9 14.8V17.85C9.2 18.45 10.55 18.7 11.85 18.7C14.5 18.7 16.3 17.35 16.3 14.95C16.3 10.95 11.1 11.7 11.1 10.2Z"
        fill="white"
      />
    </svg>
  )
}
