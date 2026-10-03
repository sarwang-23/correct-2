"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Receipt,
  UploadSimple,
  CheckCircle,
  Warning,
  Sparkle,
  FilePdf,
  FileImage,
  Eye,
  ArrowRight,
} from "@phosphor-icons/react";
import Topbar from "@/components/dashboard/Topbar";
import { useReportingPeriodContext } from "@/context/ReportingPeriodContext";
import {
  createActivityData,
  fetchAPI,
  getDocumentById,
  ocrDocument,
  requestOcr,
  submitActivityData,
  uploadDocumentV2,
} from "@/lib/api";

type Stage = "upload" | "processing" | "review" | "saved";

const ACCEPTED = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];

const CATEGORY_OPTIONS = [
  { value: "PURCHASED_ELECTRICITY", label: "Electricity", unit: "kWh", scope: "SCOPE_2" },
  { value: "PURCHASED_STEAM", label: "Steam / Heat", unit: "GJ", scope: "SCOPE_2" },
  { value: "DIESEL", label: "Diesel", unit: "litre", scope: "SCOPE_1" },
  { value: "PETROL", label: "Petrol", unit: "litre", scope: "SCOPE_1" },
  { value: "LPG", label: "LPG / PNG", unit: "kg", scope: "SCOPE_1" },
  { value: "NATURAL_GAS", label: "Natural Gas", unit: "m3", scope: "SCOPE_1" },
  { value: "WATER", label: "Water", unit: "m3", scope: "SCOPE_3" },
  { value: "BUSINESS_TRAVEL", label: "Business Travel", unit: "km", scope: "SCOPE_3" },
];

/** OCR is asynchronous on the backend; poll the document until it lands. */
const OCR_POLL_INTERVAL_MS = 2500;
const OCR_TIMEOUT_MS = 120000;

function getMimeIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return <FilePdf size={32} className="text-red-500" />;
  return <FileImage size={32} className="text-blue-500" />;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** OCR payloads differ across backend versions; accept either shape. */
function readExtraction(doc: any) {
  return doc?.extractedData ?? doc?.extraction ?? doc?.ocrResult ?? null;
}

export default function InvoiceUploadPage() {
  const router = useRouter();
  const { activePeriodId, activePeriod, isLocked, status: periodStatus, isPeriodReady } =
    useReportingPeriodContext();

  const [stage, setStage] = useState<Stage>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [documentId, setDocumentId] = useState("");
  const [saving, setSaving] = useState(false);
  const [ocrNote, setOcrNote] = useState("");
  const [savedActivityId, setSavedActivityId] = useState("");
  const [form, setForm] = useState({
    category: "PURCHASED_ELECTRICITY",
    scope: "SCOPE_2",
    quantity: "",
    unit: "kWh",
    activityDate: new Date().toISOString().slice(0, 10),
    description: "",
  });

  const fileRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  const [defaultPhysicalEntityId, setDefaultPhysicalEntityId] = useState<string | null>(null);

  // Auto-fetch the first campus so we can include physicalEntityId in the
  // activity payload — the backend requires it and returns 403 without it.
  useEffect(() => {
    async function loadCampus() {
      try {
        const res = await fetchAPI("/onboarding/hierarchy");
        const campuses = res?.data?.campuses ?? res?.campuses ?? [];
        if (campuses.length > 0) {
          setDefaultPhysicalEntityId(campuses[0].id);
          return;
        }
      } catch { /* ignore */ }
      // Fallback: try /campuses endpoint directly
      try {
        const res2 = await fetchAPI(`/campuses?universityId=${localStorage.getItem("universityId") ?? ""}`);
        const list = res2?.data ?? [];
        if (list.length > 0) setDefaultPhysicalEntityId(list[0].id);
      } catch { /* ignore */ }
    }
    loadCampus();
  }, []);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const reset = () => {
    setStage("upload");
    setFile(null);
    setError("");
    setDocumentId("");
    setOcrNote("");
    setSavedActivityId("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFile = (f: File) => {
    const ext = "." + f.name.split(".").pop()?.toLowerCase();
    if (!ACCEPTED.includes(ext)) {
      setError(`Unsupported file type. Accepted: ${ACCEPTED.join(", ")}`);
      return;
    }
    if (f.size > 20 * 1024 * 1024) {
      setError("File too large. Maximum size is 20 MB.");
      return;
    }
    setFile(f);
    setError("");
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, []);

  const applyExtraction = (extraction: any) => {
    if (!extraction) return;
    const rawCategory =
      extraction.category ?? extraction.activityCategory ?? extraction.type ?? "";
    const matched = CATEGORY_OPTIONS.find(
      (opt) =>
        opt.value.toLowerCase() === String(rawCategory).toLowerCase().replace(/\s+/g, "_")
    );
    const quantity = extraction.quantity ?? extraction.value ?? extraction.amount ?? "";

    setForm((prev) => ({
      category: matched?.value ?? prev.category,
      scope:
        extraction.scope ??
        (matched?.scope ?? prev.scope),
      quantity: quantity === "" || quantity === null ? prev.quantity : String(quantity),
      unit: extraction.unit ?? matched?.unit ?? prev.unit,
      activityDate: extraction.activityDate ?? extraction.date ?? prev.activityDate,
      description:
        extraction.vendor || extraction.invoiceNumber
          ? `${extraction.vendor ?? "Invoice"}${
              extraction.invoiceNumber ? ` · Invoice ${extraction.invoiceNumber}` : ""
            }`
          : prev.description,
    }));
  };

  const waitForOcr = async (docId: string) => {
    const deadline = Date.now() + OCR_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (cancelledRef.current) return null;
      try {
        const doc = await getDocumentById(docId);
        const body = doc?.data ?? doc;
        const extraction = readExtraction(body);
        if (extraction) return { doc: body, extraction };
        if (body?.status === "FAILED") {
          throw new Error("OCR extraction failed for this document.");
        }
      } catch (err: any) {
        // A transient read failure should not abort the whole poll loop.
        if (err?.message === "OCR extraction failed for this document.") throw err;
      }
      await sleep(OCR_POLL_INTERVAL_MS);
    }
    throw new Error("OCR timed out. You can still enter the values manually.");
  };

  const handleUpload = async () => {
    if (!file) return;
    if (!activePeriodId) {
      setError(
        isPeriodReady && periodStatus === "empty"
          ? "No reporting period exists yet. Create one under Reporting Periods first."
          : "Reporting period is still loading. Please wait a moment."
      );
      return;
    }

    cancelledRef.current = false;
    setUploading(true);
    setError("");
    setStage("processing");
    setOcrNote("Uploading document...");

    try {
      const res = await uploadDocumentV2(file);
      if (!res.ok) {
        throw new Error(
          res.data?.error?.message ?? res.data?.message ?? "Upload failed. Please try again."
        );
      }

      const docId = res.data?.data?.id ?? res.data?.id;
      if (!docId) throw new Error("Upload succeeded but no document id was returned.");
      setDocumentId(docId);

      setOcrNote("Running OCR extraction...");
      try {
        await requestOcr(docId);
      } catch {
        // Fall back to the document-scoped OCR endpoint used by /documents.
        try {
          await ocrDocument(docId);
        } catch {
          setOcrNote("OCR could not be started. Enter the values manually.");
        }
      }

      if (cancelledRef.current) return;

      let extraction: any = null;
      try {
        const result = await waitForOcr(docId);
        extraction = result?.extraction ?? null;
      } catch (ocrErr: any) {
        setOcrNote(ocrErr?.message || "OCR unavailable. Enter values manually.");
      }

      if (cancelledRef.current) return;
      if (extraction) {
        applyExtraction(extraction);
        setOcrNote("Extraction complete. Verify the values before saving.");
      }
      setStage("review");
    } catch (e: any) {
      setError(e?.message || "Upload failed.");
      setStage("upload");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!documentId) return;
    if (!form.quantity || Number.isNaN(Number(form.quantity)) || Number(form.quantity) <= 0) {
      setError("Please enter a valid positive quantity.");
      return;
    }
    if (!form.activityDate) {
      setError("Please select an activity date.");
      return;
    }
    // Warn if the date is more than 1 year in the future — OCR often misreads years
    const parsedDate = new Date(form.activityDate);
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
    if (parsedDate > oneYearFromNow) {
      setError(
        `Activity date ${form.activityDate} appears to be in the future — OCR may have misread the year. Please correct it to a date within your reporting period.`
      );
      return;
    }
    if (!activePeriodId) {
      setError("No reporting period selected.");
      return;
    }
    if (isLocked) {
      setError(
        `The current reporting period "${activePeriod?.name ?? activePeriodId}" is locked. ` +
        `Unlock it first under Reporting Periods before adding new activity data.`
      );
      return;
    }

    setSaving(true);
    setError("");
    try {
      const res = await createActivityData({
        category: form.category,
        scope: form.scope,
        quantity: Number(form.quantity),
        unit: form.unit,
        activityDate: new Date(form.activityDate).toISOString(),
        description: form.description,
        inputSource: "INVOICE",
        status: "SUBMITTED",
        reportingPeriodId: activePeriodId,
        documentId,
        ...(defaultPhysicalEntityId ? { physicalEntityId: defaultPhysicalEntityId } : {}),
      });

      const activityId = res?.data?.id ?? res?.id;
      if (!activityId) {
        throw new Error(res?.message || "Activity could not be created from this document.");
      }
      setSavedActivityId(activityId);

      // Push it into the review workflow so it reaches the calculations queue.
      try {
        await submitActivityData(activityId);
      } catch {
        // Activity exists; review transition can be retried from the list.
      }

      setStage("saved");
      toast.success("Activity created and sent for verification");
    } catch (e: any) {
      setError(e?.message || "Failed to create activity from document.");
    } finally {
      setSaving(false);
    }
  };

  const disabledReason =
    !activePeriodId && isPeriodReady && periodStatus === "empty"
      ? "No reporting period exists yet. Create one under Reporting Periods first."
      : !isPeriodReady
      ? "Resolving your reporting period..."
      : "";

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      <Topbar
        title="Invoice / Document Upload"
        subtitle="Upload invoices for AI-assisted emission data extraction"
      />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-2xl mx-auto">
          <button
            onClick={() => router.push("/activity-data")}
            className="flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-800 mb-6 transition-colors"
          >
            <ArrowLeft size={16} /> Back to Activity Data
          </button>

          {/* Steps indicator */}
          <div className="flex items-center gap-3 mb-8">
            {[
              { label: "Upload Invoice", key: "upload" },
              { label: "Processing", key: "processing" },
              { label: "Review & Save", key: "review" },
            ].map((s, i) => {
              const stages: Stage[] = ["upload", "processing", "review"];
              const currentIdx = stages.indexOf(stage);
              const stepIdx = i;
              const done = currentIdx > stepIdx;
              const active = currentIdx === stepIdx;
              return (
                <div key={s.key} className="flex items-center gap-2">
                  <div
                    className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
                      done
                        ? "bg-teal-600 border-teal-600 text-white"
                        : active
                        ? "border-teal-600 text-teal-600 bg-white"
                        : "border-slate-200 text-slate-400 bg-white"
                    }`}
                  >
                    {done ? <CheckCircle size={14} weight="fill" /> : i + 1}
                  </div>
                  <span
                    className={`text-xs font-semibold hidden sm:block ${
                      active
                        ? "text-teal-700"
                        : done
                        ? "text-teal-600"
                        : "text-slate-400"
                    }`}
                  >
                    {s.label}
                  </span>
                  {i < 2 && (
                    <div className={`h-0.5 w-8 rounded-full ${done ? "bg-teal-500" : "bg-slate-200"}`} />
                  )}
                </div>
              );
            })}
          </div>

          {disabledReason && stage === "upload" && (
            <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <Warning size={18} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">{disabledReason}</p>
            </div>
          )}

          {/* Locked-period warning shown on the review stage */}
          {isLocked && stage === "review" && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
              <div className="flex items-start gap-3">
                <Warning size={18} className="text-amber-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-amber-800">Reporting Period is Locked</p>
                  <p className="text-sm text-amber-700 mt-1">
                    You cannot save activity data to a locked reporting period.
                    Open an existing period or create a new one, then come back to upload again.
                  </p>
                  <button
                    onClick={() => router.push("/reporting-periods")}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 transition-colors"
                  >
                    Go to Reporting Periods →
                  </button>
                </div>
              </div>
            </div>
          )}


          {error && (
            <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <Warning size={18} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}


          {/* STAGE: Upload */}
          {stage === "upload" && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center">
                  <Receipt size={22} className="text-orange-500" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Upload Invoice or Receipt</h2>
                  <p className="text-xs text-slate-500">PDF, JPG, PNG, WEBP - max 20 MB</p>
                </div>
              </div>

              {!file ? (
                <label
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 text-center cursor-pointer transition-all ${
                    dragging
                      ? "border-teal-400 bg-teal-50"
                      : "border-slate-200 bg-slate-50 hover:border-teal-300 hover:bg-teal-50/40"
                  }`}
                >
                  <UploadSimple
                    size={36}
                    className={`mb-3 transition-colors ${dragging ? "text-teal-500" : "text-slate-300"}`}
                  />
                  <p className="text-sm font-semibold text-slate-600">
                    Drag &amp; drop or click to select
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Electricity bills, fuel receipts, utility invoices
                  </p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept={ACCEPTED.join(",")}
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFile(f);
                    }}
                  />
                </label>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex items-center gap-4">
                  {getMimeIcon(file.name)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{file.name}</p>
                    <p className="text-xs text-slate-400">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <button
                    onClick={() => setFile(null)}
                    className="text-xs font-semibold text-red-500 hover:text-red-700 shrink-0"
                  >
                    Remove
                  </button>
                </div>
              )}

              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => router.push("/activity-data")}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpload}
                  disabled={!file || uploading || !activePeriodId}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 px-5 py-2.5 text-sm font-bold text-white shadow-md disabled:opacity-50 hover:from-teal-500 hover:to-cyan-500 transition-all"
                >
                  <UploadSimple size={15} weight="bold" />
                  {uploading ? "Processing..." : "Upload & Extract"}
                </button>
              </div>
            </div>
          )}

          {/* STAGE: Processing */}
          {stage === "processing" && (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 shadow-sm text-center">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-50 border border-teal-100 mb-5">
                <Sparkle size={32} className="text-teal-600 animate-pulse" />
              </div>
              <h2 className="text-lg font-bold text-slate-900">Processing Document</h2>
              <p className="mt-2 text-sm text-slate-500">{ocrNote || "Running OCR..."}</p>
              <div className="mt-6 flex justify-center">
                <div className="h-2 w-48 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full w-2/3 rounded-full bg-teal-500 animate-pulse" />
                </div>
              </div>
            </div>
          )}

          {/* STAGE: Review extracted values and save */}
          {stage === "review" && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-green-200 bg-green-50 px-5 py-4 flex items-center gap-3">
                <CheckCircle size={22} className="text-green-600 shrink-0" />
                <div>
                  <p className="font-semibold text-green-800">Document uploaded successfully!</p>
                  <p className="text-sm text-green-700">
                    Document ID: <span className="font-mono text-xs">{documentId}</span>
                  </p>
                </div>
              </div>

              {ocrNote && (
                <p className="text-xs font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  {ocrNote}
                </p>
              )}

              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Eye size={18} className="text-slate-500" /> Extracted Activity Data
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-bold text-slate-700">Category</span>
                    <select
                      value={form.category}
                      onChange={(e) => {
                        const value = e.target.value;
                        const matched = CATEGORY_OPTIONS.find((o) => o.value === value);
                        setForm((f) => ({
                          ...f,
                          category: value,
                          scope: matched?.scope ?? f.scope,
                          unit: matched?.unit ?? f.unit,
                        }));
                      }}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 outline-none focus:border-teal-500 focus:ring-3 focus:ring-teal-500/15"
                    >
                      {CATEGORY_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-xs font-bold text-slate-700">Scope</span>
                    <select
                      value={form.scope}
                      onChange={(e) => setForm({ ...form, scope: e.target.value })}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 outline-none focus:border-teal-500 focus:ring-3 focus:ring-teal-500/15"
                    >
                      <option value="SCOPE_1">Scope 1</option>
                      <option value="SCOPE_2">Scope 2</option>
                      <option value="SCOPE_3">Scope 3</option>
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-xs font-bold text-slate-700">Quantity</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.quantity}
                      onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-900 outline-none focus:border-teal-500 focus:ring-3 focus:ring-teal-500/15"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-xs font-bold text-slate-700">Unit</span>
                    <input
                      type="text"
                      value={form.unit}
                      onChange={(e) => setForm({ ...form, unit: e.target.value })}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-900 outline-none focus:border-teal-500 focus:ring-3 focus:ring-teal-500/15"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-xs font-bold text-slate-700">
                      Activity Date
                    </span>
                    <input
                      type="date"
                      value={form.activityDate}
                      onChange={(e) => setForm({ ...form, activityDate: e.target.value })}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-900 outline-none focus:border-teal-500 focus:ring-3 focus:ring-teal-500/15"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-slate-700">
                    Description
                  </span>
                  <textarea
                    rows={2}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="w-full resize-none rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-3 focus:ring-teal-500/15"
                  />
                </label>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={reset}
                    className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Upload Another
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving || isLocked}
                    className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 px-5 py-2.5 text-sm font-bold text-white shadow-md disabled:opacity-50"
                  >
                    <CheckCircle size={15} weight="bold" />
                    {saving ? "Saving..." : isLocked ? "Period Locked" : "Save Activity"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STAGE: Saved */}
          {stage === "saved" && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-green-200 bg-green-50 px-5 py-4 flex items-center gap-3">
                <CheckCircle size={22} className="text-green-600 shrink-0" />
                <div>
                  <p className="font-semibold text-green-800">
                    Activity created and sent for verification
                  </p>
                  <p className="text-sm text-green-700">
                    Activity ID: <span className="font-mono text-xs">{savedActivityId}</span>
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h4 className="text-sm font-bold text-slate-800 mb-3">What's next?</h4>
                <div className="space-y-2">
                  <button
                    onClick={() => router.push("/review")}
                    className="w-full flex items-center justify-between rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 hover:bg-teal-100 transition-colors"
                  >
                    <div className="flex items-center gap-3 text-sm">
                      <Eye size={16} className="text-teal-600" />
                      <span className="font-semibold text-teal-700">
                        Review &amp; calculate CO₂e
                      </span>
                    </div>
                    <ArrowRight size={14} className="text-teal-500" />
                  </button>
                  <button
                    onClick={() => router.push("/activity-data")}
                    className="w-full flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-3 text-sm">
                      <Eye size={16} className="text-slate-400" />
                      <span className="font-semibold text-slate-700">View in Activity Data</span>
                    </div>
                    <ArrowRight size={14} className="text-slate-400" />
                  </button>
                  <button
                    onClick={reset}
                    className="w-full flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-3 text-sm">
                      <UploadSimple size={16} className="text-slate-400" />
                      <span className="font-semibold text-slate-700">Upload Another Invoice</span>
                    </div>
                    <ArrowRight size={14} className="text-slate-400" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
