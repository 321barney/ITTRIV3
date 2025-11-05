// Server component wrapper for the Studio client
import Studio from "./StudioClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return <Studio />;
}
