'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Mail, Lock, Eye, EyeOff, ArrowRight, AlertCircle,
  ShieldCheck, User, CheckCircle2,
} from 'lucide-react';
import { register } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

export default function SignUpPage() {
  const router = useRouter();
  const { setAuth } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setIsPending(true);

    const formData = new FormData(e.currentTarget);
    const name = String(formData.get('name') || '').trim();
    const email = String(formData.get('email') || '').trim();
    const password = String(formData.get('password') || '');
    const confirm = String(formData.get('confirm') || '');

    if (password !== confirm) {
      setError('Passwords do not match.');
      setIsPending(false);
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      setIsPending(false);
      return;
    }

    try {
      const res = await register({ username: name, email, password });
      if (!res.success || !res.data?.token) {
        setError(res.message || 'Registration failed. Please try again.');
        setIsPending(false);
        return;
      }
      setAuth(res.data.token, res.data.user);
      router.push('/onboarding');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register. Please try again.');
      setIsPending(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex flex-col lg:grid lg:grid-cols-12 bg-white font-sans antialiased selection:bg-teal-500/20 overflow-hidden">
      {/* LEFT COLUMN */}
      <div className="relative hidden lg:flex lg:col-span-6 xl:col-span-7 flex-col justify-between p-10 xl:p-14 bg-gradient-to-br from-slate-50 via-teal-50/30 to-slate-100/80 border-r border-slate-200/80 text-slate-900 overflow-hidden">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-[10%] -top-[10%] h-[450px] w-[450px] rounded-full bg-teal-200/30 blur-[120px]" />
          <div className="absolute right-[-5%] bottom-[-5%] h-[400px] w-[400px] rounded-full bg-cyan-200/25 blur-[120px]" />
          <div className="absolute inset-0 opacity-[0.4]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(13,148,136,0.12) 1px, transparent 0)', backgroundSize: '28px 28px' }} />
        </div>

        <div className="relative z-10 flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-3 group">
            <div className="flex size-10 items-center justify-center rounded-xl bg-white border border-slate-200/90 p-2 shadow-xs">
              <Image src="/cr.webp" alt="CarbonSynq" width={28} height={28} className="size-6 object-contain" unoptimized />
            </div>
            <div>
              <span className="text-xl font-extrabold tracking-tight text-slate-900 block leading-none">CarbonSynq</span>
              <span className="text-[10px] font-bold tracking-wider uppercase text-teal-700 mt-1 block">Carbon Accounting & Intelligence</span>
            </div>
          </Link>
        </div>

        <div className="relative z-10 my-auto py-6 max-w-xl">
          <h1 className="text-3xl xl:text-4xl font-extrabold tracking-tight text-slate-900 leading-[1.2]">
            Start measuring your carbon footprint today.
          </h1>
          <p className="mt-4 text-sm xl:text-base text-slate-600 leading-relaxed">
            Set up your workspace in minutes. Connect data sources, track Scope 1–3 emissions, and generate audit-ready reports.
          </p>

          <div className="mt-8 space-y-3">
            {[
              'GHG Protocol & BRSR compliant reports',
              'AI-powered invoice & document parsing',
              'Real-time emission factor database',
              'Automated review & approval workflows',
            ].map((item) => (
              <div key={item} className="flex items-center gap-3">
                <CheckCircle2 className="size-4 text-teal-600 shrink-0" />
                <span className="text-sm text-slate-700 font-medium">{item}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 flex items-center gap-2 text-xs text-slate-500 pt-6 border-t border-slate-200/80 font-medium">
          <ShieldCheck className="size-4 text-teal-600" />
          <span>SOC 2 Type II · ISO 14064 · 256-bit SSL Encrypted</span>
        </div>
      </div>

      {/* RIGHT COLUMN: Form */}
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

          {/* Header */}
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Create your account</h2>
            <p className="text-xs text-slate-500 mt-1 font-medium">Set up your carbon accounting workspace.</p>
          </div>

          {/* Tab Switcher */}
          <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-xl mb-6 text-xs font-semibold border border-slate-200/70">
            <Link href="/auth/signin" className="flex items-center justify-center py-1.5 px-3 rounded-lg text-slate-600 hover:text-slate-900 transition-colors">
              Sign In
            </Link>
            <span className="flex items-center justify-center py-1.5 px-3 rounded-lg bg-white text-slate-900 shadow-2xs font-bold">
              Sign Up
            </span>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name */}
            <div className="space-y-1.5">
              <label htmlFor="name" className="block text-xs font-semibold text-slate-800">Full Name</label>
              <div className="relative flex items-center">
                <span className="absolute left-3.5 text-slate-400 pointer-events-none"><User className="size-4" /></span>
                <input id="name" name="name" type="text" required placeholder="John Doe"
                  className="h-10 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15" />
              </div>
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-xs font-semibold text-slate-800">Work Email</label>
              <div className="relative flex items-center">
                <span className="absolute left-3.5 text-slate-400 pointer-events-none"><Mail className="size-4" /></span>
                <input id="email" name="email" type="email" required placeholder="name@company.com"
                  className="h-10 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15" />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-xs font-semibold text-slate-800">Password</label>
              <div className="relative flex items-center">
                <span className="absolute left-3.5 text-slate-400 pointer-events-none"><Lock className="size-4" /></span>
                <input id="password" name="password" type={showPassword ? 'text' : 'password'} required placeholder="Min. 8 characters"
                  className="h-10 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-10 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 p-1 text-slate-400 hover:text-slate-600">
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div className="space-y-1.5">
              <label htmlFor="confirm" className="block text-xs font-semibold text-slate-800">Confirm Password</label>
              <div className="relative flex items-center">
                <span className="absolute left-3.5 text-slate-400 pointer-events-none"><Lock className="size-4" /></span>
                <input id="confirm" name="confirm" type={showConfirm ? 'text' : 'password'} required placeholder="Re-enter password"
                  className="h-10 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-10 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15" />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3.5 p-1 text-slate-400 hover:text-slate-600">
                  {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 font-medium">
                <AlertCircle className="size-4 shrink-0 text-red-600" />
                <span>{error}</span>
              </motion.div>
            )}

            {/* Submit */}
            <button type="submit" disabled={isPending}
              className="h-11 w-full mt-2 flex items-center justify-center gap-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold shadow-sm transition-all disabled:opacity-60 disabled:pointer-events-none">
              {isPending ? (
                <><span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /><span>Creating account…</span></>
              ) : (
                <><span>Create Account</span><ArrowRight className="size-4" /></>
              )}
            </button>

            <p className="text-center text-xs text-slate-500 mt-2">
              Already have an account?{' '}
              <Link href="/auth/signin" className="font-semibold text-teal-600 hover:text-teal-700">Sign in</Link>
            </p>
          </form>
        </motion.div>
      </div>
    </div>
  );
}