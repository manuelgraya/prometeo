/** Iconos de trazo (SVG en línea con currentColor): siguen el color del tema sin ficheros aparte. */
import type { ReactNode } from 'react'

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

export const MicIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7" />
  </Icon>
)

export const MicOffIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M15 9.5V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.9 2.3" />
    <path d="M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3M8.5 21h7M3 3l18 18" />
  </Icon>
)

export const SendIcon = () => (
  <Icon>
    <path d="M4 12 20 4l-5 16-3-7-8-1Z" />
    <path d="m12 13 8-9" />
  </Icon>
)

export const StopIcon = () => (
  <Icon><rect x="6" y="6" width="12" height="12" rx="1.5" /></Icon>
)

export const CopyIcon = () => (
  <Icon>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </Icon>
)

export const CheckIcon = () => (
  <Icon><path d="m5 12 5 5L20 7" /></Icon>
)

export const DownloadIcon = () => (
  <Icon><path d="M12 3v12M7 10l5 5 5-5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></Icon>
)

export const ExpandIcon = () => (
  <Icon><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" /></Icon>
)

export const CloseIcon = () => (
  <Icon><path d="M6 6l12 12M18 6 6 18" /></Icon>
)

export const ChatIcon = () => (
  <Icon><path d="M4 5h16v11H9l-5 4V5Z" /><path d="M8 10h8M8 13h5" /></Icon>
)

export const ForgeIcon = () => (
  <Icon><path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z" /></Icon>
)
