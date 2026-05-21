/**
 * @fileoverview Clean Word-mimic print engine for the questionnaire.
 *
 * Renders ONLY committed (non-draft, checked) answers on a black-on-white
 * 8.5"x11" serif canvas suitable for native browser print. The mounting page
 * (`/questionnaire/print`) uses a sidebar-free layout and `@media print` rules
 * to suppress everything outside this surface.
 */

interface PrintedItem {
  code: string;
  text: string;
  notes: string | null;
  sectionName: string;
}

interface ChecklistPrintViewProps {
  completedItems: PrintedItem[];
  projectName?: string;
}

export function ChecklistPrintView({
  completedItems,
  projectName = "126 Colby Remodel — Project Blueprint",
}: ChecklistPrintViewProps) {
  const triggerPrint = () => {
    if (typeof window !== "undefined") {
      window.print();
    }
  };

  return (
    <div className="relative mx-auto min-h-screen max-w-[8.5in] bg-white p-10 font-serif text-black print:p-0">
      <div className="mb-6 flex items-center justify-between rounded border border-gray-300 bg-gray-50 p-4 font-sans print:hidden">
        <div>
          <h4 className="text-sm font-bold text-gray-900">
            Field-ready specification ledger
          </h4>
          <p className="text-xs font-light text-gray-500">
            Filters out drafts and empty entries; renders verified rows into a
            letter-paper template for clipboard handoff.
          </p>
        </div>
        <button
          type="button"
          onClick={triggerPrint}
          className="rounded bg-black px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white shadow-sm transition-all hover:bg-gray-800"
        >
          Trigger print
        </button>
      </div>

      <div className="space-y-6 print:space-y-4">
        <div className="border-b-4 border-black pb-4 text-center">
          <h1 className="m-0 font-serif text-2xl font-black uppercase tracking-tight">
            {projectName}
          </h1>
          <p className="mt-1 text-xs italic text-gray-600">
            Immutable verification audit record of committed selections
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-gray-400">
            Compiled: {new Date().toLocaleDateString()}
          </p>
        </div>

        {completedItems.length === 0 ? (
          <p className="py-12 text-center font-sans text-xs italic text-gray-400">
            No specifications have been committed yet — switch a row to Verified
            in /questionnaire to populate this ledger.
          </p>
        ) : (
          <div className="space-y-6">
            {completedItems.map((item, index) => {
              const showHeader =
                index === 0 ||
                completedItems[index - 1].sectionName !== item.sectionName;
              return (
                <div
                  key={`${item.code}-${index}`}
                  className="space-y-1.5 break-inside-avoid"
                >
                  {showHeader && (
                    <h2 className="mt-5 border-l-4 border-black bg-gray-100 px-2 py-1 font-sans text-xs font-black uppercase tracking-widest text-gray-800">
                      {item.sectionName}
                    </h2>
                  )}
                  <div className="space-y-1 pl-2 text-xs">
                    <p className="m-0 font-bold leading-tight">
                      <span className="mr-2 font-mono text-[10px] text-gray-500">
                        [{item.code}]
                      </span>
                      {item.text}
                    </p>
                    <p className="m-0 pl-6 font-sans text-[11px] text-gray-800">
                      <span className="mr-1.5 text-[9px] font-black uppercase tracking-wider text-gray-400">
                        Verification status:
                      </span>
                      Confirmed / Field-ready specification
                    </p>
                    {item.notes && (
                      <p className="m-0 border-l-2 border-gray-200 py-0.5 pl-6 font-sans text-[11px] italic text-gray-600">
                        <span className="block text-[9px] font-bold not-italic uppercase tracking-wider text-gray-400">
                          Homeowner directives:
                        </span>
                        &quot;{item.notes}&quot;
                      </p>
                    )}
                    <div className="border-b border-dashed border-gray-300 pb-1 pl-6 pt-2 font-sans text-[10px] text-gray-400">
                      <span>
                        Crew field log / review notes:
                        ________________________________________________________________
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              body { background: white !important; color: black !important; }
              aside, header, nav, footer, .print\\:hidden { display: none !important; }
              @page { size: letter; margin: 0.75in; }
            }
          `,
        }}
      />
    </div>
  );
}
