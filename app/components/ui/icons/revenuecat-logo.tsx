import { SVGProps } from 'react'

export default function RevenueCatLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <rect width="24" height="24" rx="4" fill="#F25C54" />
      <path
        d="M7 10.5C7 9.67 7.67 9 8.5 9C9.33 9 10 9.67 10 10.5C10 11.33 9.33 12 8.5 12C7.67 12 7 11.33 7 10.5Z"
        fill="white"
      />
      <path
        d="M14 10.5C14 9.67 14.67 9 15.5 9C16.33 9 17 9.67 17 10.5C17 11.33 16.33 12 15.5 12C14.67 12 14 11.33 14 10.5Z"
        fill="white"
      />
      <path
        d="M8 15C8 15 9.5 17 12 17C14.5 17 16 15 16 15"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
