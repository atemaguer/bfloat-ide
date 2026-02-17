export default function ConvexLogo({
  width = "21.53",
  height = "22",
  style,
}: {
  width?: string
  height?: string
  style?: React.CSSProperties
}) {
  return (
    <svg width={width} height={height} viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg" style={style}>
      <path
        d="M10.8962 0.620667C11.1962 0.460667 11.5562 0.460667 11.8562 0.620667L21.0562 5.72067C21.3562 5.88067 21.5362 6.20067 21.5362 6.54067V15.4607C21.5362 15.8007 21.3562 16.1207 21.0562 16.2807L11.8562 21.3807C11.5562 21.5407 11.1962 21.5407 10.8962 21.3807L1.69621 16.2807C1.39621 16.1207 1.21621 15.8007 1.21621 15.4607V6.54067C1.21621 6.20067 1.39621 5.88067 1.69621 5.72067L10.8962 0.620667Z"
        fill="url(#paint0_linear)"
      />
      <path
        d="M11.3762 11.0007L6.89621 8.50067V13.5007L11.3762 16.0007V11.0007Z"
        fill="url(#paint1_linear)"
      />
      <path
        d="M11.3762 11.0007V16.0007L15.8562 13.5007V8.50067L11.3762 11.0007Z"
        fill="url(#paint2_linear)"
      />
      <defs>
        <linearGradient
          id="paint0_linear"
          x1="11.3762"
          y1="0.000670433"
          x2="11.3762"
          y2="22.0007"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FF6B00" />
          <stop offset="1" stopColor="#FF3D00" />
        </linearGradient>
        <linearGradient
          id="paint1_linear"
          x1="9.13621"
          y1="8.50067"
          x2="9.13621"
          y2="16.0007"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FFE5D9" />
          <stop offset="1" stopColor="#FFD9CC" />
        </linearGradient>
        <linearGradient
          id="paint2_linear"
          x1="13.6162"
          y1="8.50067"
          x2="13.6162"
          y2="16.0007"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FFD9CC" />
          <stop offset="1" stopColor="#FFCCBF" />
        </linearGradient>
      </defs>
    </svg>
  )
}
