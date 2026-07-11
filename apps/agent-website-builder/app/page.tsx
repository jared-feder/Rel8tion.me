import { redirect } from 'next/navigation'

export default function HomePage() {
  // Redirect homepage to the get-started page
  redirect('/get-started')
}
