"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { X, CheckCircle, Robot, FileText } from "@phosphor-icons/react";
import { EASE } from "@/lib/animations";
import { createActivityData, submitActivityData } from "@/lib/api";
import { useReportingPeriodContext } from "@/context/ReportingPeriodContext";
import { toast } from "sonner";

interface OCRReviewModalProps {
  document: any;
  onClose: () => void;
  onSuccess: () => void;
}

const CATEGORY_OPTIONS = [
  { value: "PURCHASED_ELECTRICITY", label: "Electricity", scope: "SCOPE_2" },
  { value: "PURCHASED_STEAM", label: "Steam / Heat", scope: "SCOPE_2" },
  { value: "DIESEL", label: "Diesel", scope: "SCOPE_1" },
  { value: "PETROL", label: "Petrol", scope: "SCOPE_1" },
  { value: "LPG", label: "LPG / PNG", scope: "SCOPE_1" },
  { value: "NATURAL_GAS", label: "Natural Gas", scope: "SCOPE_1" },
  { value: "WATER", label: "Water", scope: "SCOPE_3" },
  { value: "BUSINESS_TRAVEL", label: "Business Travel", scope: "SCOPE_3" },
];

/** OCR payloads differ across backend versions; accept either shape. */
function readExtraction(doc: any) {
  return doc?.extractedData ?? doc?.extraction ?? null;
}

export default function OCRReviewModal({ document, onClose, onSuccess }: OCRReviewModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { activePeriodId } = useReportingPeriodContext();

  const extraction = readExtraction(document) ?? {};
  const matchedCategory = CATEGORY_OPTIONS.find(
    (o) => o.value === extraction.category
  );

  // Pre-fill with OCR extracted data or fallback to defaults
  const [formData, setFormData] = useState({
    category: matchedCategory?.value ?? extraction.category ?? "PURCHASED_ELECTRICITY",
    scope: extraction.scope ?? matchedCategory?.scope ?? "SCOPE_2",
    quantity: extraction.quantity != null ? String(extraction.quantity) : "",
    unit: extraction.unit ?? "kWh",
    activityDate: extraction.activityDate
      ? new Date(extraction.activityDate).toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0],
    description: `Parsed from document: ${document.fileName}`,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const quantity = Number(formData.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError("Please enter a valid positive quantity.");
      return;
    }
    if (!activePeriodId) {
      setError("No reporting period is selected. Activities cannot be created without one.");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        category: formData.category,
        scope: formData.scope,
        quantity,
        unit: formData.unit,
        activityDate: new Date(formData.activityDate).toISOString(),
        description: formData.description,
        inputSource: "INVOICE",
        status: "DRAFT",
        reportingPeriodId: activePeriodId,
      };

      const res = await createActivityData({
        ...payload,
        documentId: document.id,
      });
      const activityId = res?.data?.id ?? res?.id;
      if (!activityId) {
        throw new Error(res?.message || "Failed to create activity");
      }

      // Move it into the review workflow so it reaches the calculations queue.
      try {
        await submitActivityData(activityId);
      } catch {
        // Activity was created; the transition can be retried from the list.
      }

      toast.success("Activity created from document and sent for verification");
      onSuccess();
    } catch (err: any) {
      setError(err?.message || "An error occurred");
      toast.error(err?.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.95 }}
        transition={{ duration: 0.3, ease: EASE }}
        className="relative z-10 w-full max-w-3xl rounded-[16px] bg-white p-[24px] shadow-xl mx-[20px] max-h-[90vh] overflow-hidden flex flex-col"
      >
        <div className="mb-[20px] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-[12px]">
            <div className="flex h-[40px] w-[40px] items-center justify-center rounded-[8px] bg-blue-100 text-blue-600">
              <Robot size={24} weight="fill" />
            </div>
            <div>
              <h2 className="text-[18px] font-semibold text-black">Review Extracted Data</h2>
              <p className="text-[13px] text-[#71717a]">Verify the AI-parsed fields from your document before creating an activity.</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#a1a1aa] hover:text-black transition-colors self-start mt-[-8px]">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pr-[8px]">
          {error && (
            <div className="mb-[16px] rounded-[8px] border border-red-200 bg-red-50 px-[12px] py-[8px] text-[12px] font-medium text-red-700">
              {error}
            </div>
          )}
          <div className="grid grid-cols-[1fr_350px] gap-[24px]">
            
            {/* Left: Document Info */}
            <div className="flex flex-col gap-[16px]">
              <div className="rounded-[12px] border border-black/[0.08] bg-[#fafafa] p-[16px] flex flex-col gap-[12px]">
                <div className="flex items-center gap-[8px] text-[14px] font-semibold text-black mb-[4px]">
                  <FileText size={18} /> Source Document
                </div>
                <div className="flex justify-between items-center pb-[8px] border-b border-black/[0.04]">
                  <span className="text-[12px] font-semibold text-[#52525b]">File Name</span>
                  <span className="text-[12px] text-black font-medium truncate max-w-[200px]" title={document.fileName}>{document.fileName}</span>
                </div>
                {document.extractedData?.vendor && (
                  <div className="flex justify-between items-center pb-[8px] border-b border-black/[0.04]">
                    <span className="text-[12px] font-semibold text-[#52525b]">Vendor</span>
                    <span className="text-[12px] text-black font-medium">{document.extractedData.vendor}</span>
                  </div>
                )}
                {document.extractedData?.invoiceNumber && (
                  <div className="flex justify-between items-center pb-[8px] border-b border-black/[0.04]">
                    <span className="text-[12px] font-semibold text-[#52525b]">Invoice No.</span>
                    <span className="text-[12px] text-black font-medium">{document.extractedData.invoiceNumber}</span>
                  </div>
                )}
                {document.extractedData?.amount && (
                  <div className="flex justify-between items-center pb-[8px] border-b border-black/[0.04]">
                    <span className="text-[12px] font-semibold text-[#52525b]">Amount</span>
                    <span className="text-[12px] text-black font-medium">{document.extractedData.amount} {document.extractedData.currency || ''}</span>
                  </div>
                )}
                {document.fileUrl && (
                  <a href={document.fileUrl} target="_blank" rel="noreferrer" className="mt-[8px] flex items-center justify-center gap-[6px] rounded-[8px] bg-white border border-black/[0.08] px-[12px] py-[8px] text-[12px] font-semibold text-black hover:bg-black/5 transition-colors">
                    View Document
                  </a>
                )}
              </div>
              
              <div className="rounded-[12px] border border-[#16a34a]/20 bg-[#f0fdf4] p-[16px]">
                <div className="flex items-start gap-[12px]">
                  <CheckCircle size={20} weight="fill" className="text-[#16a34a] shrink-0 mt-[2px]" />
                  <div>
                    <h3 className="text-[13px] font-semibold text-[#15803d]">AI Extraction Successful</h3>
                    <p className="text-[12px] text-[#16a34a] mt-[4px]">
                      The document was successfully parsed. Please review the values on the right and adjust if necessary.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Editable Form */}
            <form id="ocr-form" onSubmit={handleSubmit} className="flex flex-col gap-[16px]">
              <div className="flex flex-col gap-[6px]">
                <label className="text-[12px] font-semibold text-[#52525b]">Category</label>
                <select
                  required
                  value={formData.category}
                  onChange={(e) => {
                    const value = e.target.value;
                    const matched = CATEGORY_OPTIONS.find((o) => o.value === value);
                    setFormData((f) => ({
                      ...f,
                      category: value,
                      scope: matched?.scope ?? f.scope,
                    }));
                  }}
                  className="h-[36px] w-full rounded-[8px] border border-black/[0.08] bg-white px-[12px] text-[13px] text-black outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                >
                  {CATEGORY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                  {!CATEGORY_OPTIONS.some((o) => o.value === formData.category) && (
                    <option value={formData.category}>{formData.category}</option>
                  )}
                </select>
              </div>

              <div className="flex flex-col gap-[6px]">
                <label className="text-[12px] font-semibold text-[#52525b]">Scope</label>
                <select
                  required
                  value={formData.scope}
                  onChange={(e) => setFormData({ ...formData, scope: e.target.value })}
                  className="h-[36px] w-full rounded-[8px] border border-black/[0.08] bg-white px-[12px] text-[13px] text-black outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                >
                  <option value="SCOPE_1">Scope 1</option>
                  <option value="SCOPE_2">Scope 2</option>
                  <option value="SCOPE_3">Scope 3</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-[12px]">
                <div className="flex flex-col gap-[6px]">
                  <label className="text-[12px] font-semibold text-[#52525b]">Quantity</label>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.quantity}
                    onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                    className="h-[36px] w-full rounded-[8px] border border-black/[0.08] bg-white px-[12px] text-[13px] text-black outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div className="flex flex-col gap-[6px]">
                  <label className="text-[12px] font-semibold text-[#52525b]">Unit</label>
                  <input
                    required
                    type="text"
                    value={formData.unit}
                    onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                    className="h-[36px] w-full rounded-[8px] border border-black/[0.08] bg-white px-[12px] text-[13px] text-black outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-[6px]">
                <label className="text-[12px] font-semibold text-[#52525b]">Activity Date</label>
                <input
                  required
                  type="date"
                  value={formData.activityDate}
                  onChange={(e) => setFormData({ ...formData, activityDate: e.target.value })}
                  className="h-[36px] w-full rounded-[8px] border border-black/[0.08] bg-white px-[12px] text-[13px] text-black outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex flex-col gap-[6px]">
                <label className="text-[12px] font-semibold text-[#52525b]">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="h-[60px] w-full resize-none rounded-[8px] border border-black/[0.08] bg-white p-[12px] text-[13px] text-black outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </form>
          </div>
        </div>

        <div className="mt-[20px] pt-[16px] border-t border-black/[0.08] shrink-0 flex justify-end gap-[12px]">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] px-[16px] py-[8px] text-[13px] font-semibold text-[#52525b] hover:bg-black/5 transition-colors"
          >
            Cancel
          </button>
          <button
            form="ocr-form"
            type="submit"
            disabled={loading}
            className="rounded-[8px] bg-[#16a34a] px-[16px] py-[8px] text-[13px] font-semibold text-white hover:bg-[#15803d] transition-colors disabled:opacity-50"
          >
            {loading ? "Creating..." : "Confirm & Create Activity"}
          </button>
        </div>

      </motion.div>
    </div>
  );
}
