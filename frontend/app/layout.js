import '@/index.css'

export const metadata = {
  title: 'PHED - Public Health Engineering Department',
  description: 'Public Health Engineering Department - (PHED) - PHED Survey & Notice Distribution System',
  manifest: '/manifest.json',
  icons: { icon: '/phed-logo.png', apple: '/phed-logo.png' },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1565C0',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <noscript>You need to enable JavaScript to run this app.</noscript>
        <div id="root">{children}</div>
      </body>
    </html>
  )
}
