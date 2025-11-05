// src/app/dashboard/stores/[id]/page.tsx
import StoreView from "./store-view";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page({ params }: { params: { id: string } }) {
  const id = decodeURIComponent(params.id);
  return <StoreView id={id} />;
}
