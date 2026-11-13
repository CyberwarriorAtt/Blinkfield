import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Blinkfield, type SkySearch } from "@/components/blinkfield/app";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): SkySearch => {
    const ra = Number(search.ra);
    const dec = Number(search.dec);
    const fov = Number(search.fov);
    const det = Number(search.det);
    return {
      ra: Number.isFinite(ra) ? ((ra % 360) + 360) % 360 : 269.452075,
      dec: Number.isFinite(dec) ? Math.min(90, Math.max(-90, dec)) : 4.693391,
      fov: Number.isFinite(fov) ? Math.min(20, Math.max(4, fov)) : 6,
      det: det >= 1 && det <= 6 ? Math.round(det) : 2,
    };
  },
  component: Home,
});

function Home() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  return (
    <Blinkfield
      search={search}
      onSearch={(next) => {
        void navigate({ to: "/", search: next, replace: true });
      }}
    />
  );
}
