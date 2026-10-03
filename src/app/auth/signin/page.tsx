'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  AlertCircle,
  ShieldCheck,
  CheckCircle2,
  Globe2,
  Quote,
} from 'lucide-react';
import { login } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

export default function SignInPage() {
  const router = useRouter();
  const { setAuth } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setIsPending(true);

    const formData = new FormData(e.currentTarget);
    const email = String(formData.get('email') || '').trim();
    const password = String(formData.get('password') || '');

    try {
      const res = await login(email, password);
      if (!res.success || !res.data?.token) {
        setError(res.message || 'Invalid email or password. Please verify your credentials.');
        setIsPending(false);
        return;
      }
      setAuth(res.data.token, res.data.user);

      // Check actual onboarding completion status from the backend.
      // organisationId being set does not guarantee onboarding was finished.
      let destination = '/dashboard';
      try {
        const { getOnboardingStatus } = await import('@/lib/api');
        const onbStatus = await getOnboardingStatus();
        if (onbStatus.kind === 'not-found') {
          destination = '/onboarding';
        }
      } catch {
        // If status check fails, fall back to organisationId heuristic
        if (!res.data.user?.organisationId) destination = '/onboarding';
      }

      router.push(destination);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign in. Please try again.');
      setIsPending(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex flex-col lg:grid lg:grid-cols-12 bg-white font-sans antialiased selection:bg-teal-500/20 overflow-hidden">
      {/* LEFT COLUMN: Clean Enterprise Brand & Validation Showcase (Light) */}
      <div className="relative hidden lg:flex lg:col-span-6 xl:col-span-7 flex-col justify-between p-10 xl:p-14 bg-gradient-to-br from-slate-50 via-teal-50/30 to-slate-100/80 border-r border-slate-200/80 text-slate-900 overflow-hidden">
        {/* Subtle Ambient Glows */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-[10%] -top-[10%] h-[450px] w-[450px] rounded-full bg-teal-200/30 blur-[120px]" />
          <div className="absolute right-[-5%] bottom-[-5%] h-[400px] w-[400px] rounded-full bg-cyan-200/25 blur-[120px]" />
          <div
            className="absolute inset-0 opacity-[0.4]"
            style={{
              backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(13, 148, 136, 0.12) 1px, transparent 0)',
              backgroundSize: '28px 28px',
            }}
          />
        </div>

        {/* Top Brand & Status */}
        <div className="relative z-10 flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-3 group">
            <div className="flex size-10 items-center justify-center rounded-xl bg-white border border-slate-200/90 p-2 shadow-xs group-hover:border-teal-400 transition-colors">
              <Image
                src="/cr.webp"
                alt="CarbonSynq"
                width={28}
                height={28}
                className="size-6 object-contain"
                unoptimized
              />
            </div>
            <div>
              <span className="text-xl font-extrabold tracking-tight text-slate-900 block leading-none">
                CarbonSynq
              </span>
              <span className="text-[10px] font-bold tracking-wider uppercase text-teal-700 mt-1 block">
                Carbon Accounting & Intelligence
              </span>
            </div>
          </Link>

          <div className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-white/90 px-3 py-1 text-xs font-semibold text-teal-800 shadow-2xs backdrop-blur-md">
            <span className="size-1.5 rounded-full bg-teal-500 animate-pulse" />
            <span>GHG Protocol & BRSR Verified</span>
          </div>
        </div>

        {/* Main Narrative & Value Showcase */}
        <div className="relative z-10 my-auto py-6 max-w-xl">
          <h1 className="text-3xl xl:text-4xl font-extrabold tracking-tight text-slate-900 leading-[1.2]">
            The enterprise carbon ledger for modern sustainability leaders.
          </h1>

          <p className="mt-4 text-sm xl:text-base text-slate-600 leading-relaxed font-normal">
            Automate Scope 1, 2, and 3 emissions accounting across global facilities, utility providers,
            and supply chain networks with mathematical audit traceability.
          </p>

          {/* Testimonial Quote Card */}
          <div className="mt-8 rounded-2xl border border-slate-200/90 bg-white/90 p-5 shadow-xs backdrop-blur-md">
            <Quote className="size-5 text-teal-600/70 mb-2.5" />
            <p className="text-sm text-slate-700 leading-relaxed italic">
              &ldquo;CarbonSynq unified our emission calculations across 38 manufacturing sites. We reduced our
              audit preparation cycle from 6 weeks to 3 business days.&rdquo;
            </p>
            <div className="mt-4 flex items-center justify-between pt-3 border-t border-slate-100 text-xs">
              <div>
                <span className="font-bold text-slate-900 block">Dr. Arthur Vance</span>
                <span className="text-slate-500 text-[11px] block">Global Head of Sustainability Â· CleanEnergy Corp</span>
              </div>
              <span className="text-[10px] font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-full">
                Verified Customer
              </span>
            </div>
          </div>

          {/* 3 Metrics Ribbon */}
          <div className="mt-8 grid grid-cols-3 gap-3 pt-6 border-t border-slate-200/80 text-xs">
            <div>
              <span className="text-2xl font-black text-slate-900 block">1.8M+</span>
              <span className="text-[11px] text-slate-500 font-semibold">tCOâ‚‚e Measured</span>
            </div>
            <div>
              <span className="text-2xl font-black text-teal-600 block">500+</span>
              <span className="text-[11px] text-slate-500 font-semibold">Emission Factor DBs</span>
            </div>
            <div>
              <span className="text-2xl font-black text-slate-900 block">100%</span>
              <span className="text-[11px] text-slate-500 font-semibold">Audit Readiness</span>
            </div>
          </div>
        </div>

        {/* Bottom Security Footer */}
        <div className="relative z-10 flex items-center justify-between text-xs text-slate-500 pt-6 border-t border-slate-200/80 shrink-0 font-medium">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="size-4 text-teal-600" />
            SOC 2 Type II Certified
          </span>
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5 text-teal-600" />
            ISO 14064 Compliant
          </span>
          <span className="flex items-center gap-1.5">
            <Globe2 className="size-3.5 text-teal-600" />
            PCAF Data Quality Tier 1
          </span>
        </div>
      </div>

      {/* RIGHT COLUMN: Clean Studio Form (Light) */}
      <div className="flex-1 lg:col-span-6 xl:col-span-5 flex flex-col justify-center items-center px-6 py-8 sm:px-10 lg:px-12 xl:px-16 min-h-screen bg-white">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="w-full max-w-[380px] mx-auto"
        >
          {/* Mobile Header */}
          <div className="lg:hidden text-center mb-6">
            <Link href="/" className="inline-flex items-center gap-2.5 mb-2">
              <div className="flex size-9 items-center justify-center rounded-xl bg-teal-600 text-white p-1.5">
                <Image src="/cr.webp" alt="CarbonSynq" width={24} height={24} className="size-5 object-contain" unoptimized />
              </div>
              <span className="text-xl font-bold tracking-tight text-slate-900">CarbonSynq</span>
            </Link>
          </div>

          {/* Form Header */}
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Sign in to your account</h2>
            <p className="text-xs text-slate-500 mt-1 font-medium">
              Enter your work credentials to access the carbon workspace.
            </p>
          </div>

          {/* Tab Switcher */}
          <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-xl mb-6 text-xs font-semibold border border-slate-200/70">
            <span className="flex items-center justify-center py-1.5 px-3 rounded-lg bg-white text-slate-900 shadow-2xs font-bold">
              Sign In
            </span>
            <Link
              href="/auth/signup"
              className="flex items-center justify-center py-1.5 px-3 rounded-lg text-slate-600 hover:text-slate-900 transition-colors"
            >
              Request Access
            </Link>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Work Email */}
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-xs font-semibold text-slate-800">
                Work Email
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-3.5 text-slate-400 pointer-events-none">
                  <Mail className="size-4" />
                </span>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  placeholder="name@company.com"
                  className="h-10.5 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all hover:border-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="block text-xs font-semibold text-slate-800">
                  Password
                </label>
                <Link href="/auth/recover" className="text-xs font-semibold text-teal-600 hover:text-teal-700 transition-colors">
                  Forgot password?
                </Link>
              </div>
              <div className="relative flex items-center">
                <span className="absolute left-3.5 text-slate-400 pointer-events-none">
                  <Lock className="size-4" />
                </span>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
                  className="h-10.5 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-10 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all hover:border-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 p-1 text-slate-400 hover:text-slate-600 transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {/* Error message */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 font-medium"
              >
                <AlertCircle className="size-4 shrink-0 text-red-600" />
                <span>{error}</span>
              </motion.div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isPending}
              className="h-11 w-full mt-2 flex items-center justify-center gap-2 rounded-xl bg-teal-600 hover:bg-teal-700 active:scale-[0.99] text-white text-sm font-semibold shadow-sm transition-all disabled:opacity-60 disabled:pointer-events-none cursor-pointer"
            >
              {isPending ? (
                <>
                  <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  <span>Signing inâ€¦</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="size-4" />
                </>
              )}
            </button>
          </form>

          {/* Footer Security Tag */}
          <div className="mt-8 pt-6 border-t border-slate-200 text-center text-xs text-slate-500 font-medium">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-teal-600" />
              256-bit SSL Encrypted & SOC 2 Certified
            </span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
