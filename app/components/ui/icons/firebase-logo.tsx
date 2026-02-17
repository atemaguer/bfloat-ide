export default function FirebaseLogo({
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
      <path d="M4.53 18.64L6.09 3.9a.47.47 0 01.86-.26l1.68 3.14-4.1 11.86z" fill="#FFA000"/>
      <path d="M9.91 9.65l-1.28 2.43L6.95 8.59a.47.47 0 01.75-.52l2.21 1.58z" fill="#F57C00"/>
      <path d="M19.47 18.64L17.88 3.9a.47.47 0 00-.78-.3l-12.57 15.04 6.76 3.89a1.41 1.41 0 001.42 0l6.76-3.89z" fill="#FFCA28"/>
      <path d="M12 22.53l6.76-3.89.71-14.74a.47.47 0 00-.78-.3L4.53 18.64 12 22.53z" fill="url(#firebase_gradient)"/>
      <path d="M12 22.53L4.53 18.64l-.02.02 6.78 3.91a1.41 1.41 0 001.42 0l.71-.41-1.42.37z" fill="#A52714" fillOpacity=".2"/>
      <defs>
        <linearGradient id="firebase_gradient" x1="12" y1="3.3" x2="12" y2="22.53" gradientUnits="userSpaceOnUse">
          <stop stopColor="#A52714" stopOpacity=".4"/>
          <stop offset="1" stopColor="#A52714" stopOpacity="0"/>
        </linearGradient>
      </defs>
    </svg>
  )
}
