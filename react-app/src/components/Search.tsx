import { PlaceholdersAndVanishInput } from "@/components/ui/placeholders-and-vanish-input";

// Aceternity search: filters as you type; Enter "vanishes" the text and clears the filter
export function Search({ placeholders, onChange }: { placeholders: string[]; onChange: (q: string) => void }) {
  return (
    <div className="w-full max-w-xl [&_form]:!max-w-none [&_form]:!shadow-sm">
      <PlaceholdersAndVanishInput placeholders={placeholders} onChange={(e) => onChange(e.target.value)} onSubmit={() => onChange("")} />
    </div>
  );
}
