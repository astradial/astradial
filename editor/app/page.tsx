import { redirect } from "next/navigation";

// Root path is a shortcut to the dashboard login. We don't run a separate
// marketing landing page on editor.example.com — the editor IS the app.
// Any /public-facing marketing lives at astradial.com.
export default function Home() {
  redirect("/dashboard");
}
