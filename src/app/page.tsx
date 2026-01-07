'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Zap, Battery, TrendingUp, Shield, ArrowRight, Users, Leaf, Clock } from 'lucide-react'
import NeuSwitch from '@/components/NeuSwitch'

export default function Home() {
  const [gridConnected, setGridConnected] = useState(false)
  const sectionRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [isActive, setIsActive] = useState(false)

  // Smooth scroll animation state
  const targetScrollRef = useRef(0)
  const currentScrollRef = useRef(0)
  const animationRef = useRef<number | null>(null)

  // Use IntersectionObserver to detect when section is mostly visible
  useEffect(() => {
    const section = sectionRef.current
    const scrollContainer = scrollContainerRef.current
    if (!section) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        const nowActive = entry.intersectionRatio >= 0.8
        
        // When becoming active, sync scroll refs with actual scroll position
        if (nowActive && scrollContainer) {
          const currentScroll = scrollContainer.scrollLeft
          targetScrollRef.current = currentScroll
          currentScrollRef.current = currentScroll
        }
        
        // When becoming inactive, cancel any running animation
        if (!nowActive && animationRef.current) {
          cancelAnimationFrame(animationRef.current)
          animationRef.current = null
        }
        
        setIsActive(nowActive)
      },
      { threshold: [0, 0.5, 0.8, 1] }
    )

    observer.observe(section)
    return () => observer.disconnect()
  }, [])

  // Smooth scroll animation loop
  const animateScroll = useCallback(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    const target = targetScrollRef.current
    const current = currentScrollRef.current
    
    // Ease towards target (lower = smoother but slower)
    const diff = target - current
    const ease = 0.12
    const newScroll = current + diff * ease

    // If we're close enough, snap to target and stop animating
    if (Math.abs(diff) < 0.5) {
      scrollContainer.scrollLeft = target
      currentScrollRef.current = target
      animationRef.current = null
      return
    }

    scrollContainer.scrollLeft = newScroll
    currentScrollRef.current = newScroll
    animationRef.current = requestAnimationFrame(animateScroll)
  }, [])

  // Handle wheel to convert vertical scroll to horizontal when section is active
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    const handleWheel = (e: WheelEvent) => {
      if (!isActive) return // Not in horizontal section, allow normal scroll

      // Always sync refs with actual scroll position first (in case of manual scroll)
      const actualScroll = scrollContainer.scrollLeft
      if (Math.abs(actualScroll - currentScrollRef.current) > 50) {
        // User probably scrolled manually, resync
        currentScrollRef.current = actualScroll
        targetScrollRef.current = actualScroll
      }

      // Calculate horizontal scroll position
      const maxScroll = scrollContainer.scrollWidth - scrollContainer.clientWidth
      const atStart = scrollContainer.scrollLeft <= 10
      const atEnd = scrollContainer.scrollLeft >= maxScroll - 10

      // Determine scroll direction
      const scrollingDown = e.deltaY > 0
      const scrollingUp = e.deltaY < 0

      // At start and scrolling up → let page scroll back to hero
      if (atStart && scrollingUp) {
        return
      }

      // At end and scrolling down → let page scroll to next section
      if (atEnd && scrollingDown) {
        return
      }

      // In the middle → prevent vertical scroll, do horizontal instead
      e.preventDefault()
      
      // Normalize delta for different input devices
      let delta = e.deltaY
      if (e.deltaMode === 1) delta *= 30 // Line mode (mouse wheel)
      if (e.deltaMode === 2) delta *= window.innerHeight // Page mode

      // Update target scroll position (clamped to valid range)
      const newTarget = Math.max(0, Math.min(maxScroll, targetScrollRef.current + delta))
      targetScrollRef.current = newTarget

      // Start animation if not already running
      if (!animationRef.current) {
        animationRef.current = requestAnimationFrame(animateScroll)
      }
    }

    window.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      window.removeEventListener('wheel', handleWheel)
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [isActive, animateScroll])

  const features = [
    {
      icon: Zap,
      title: "Smart Charging",
      description: "AI-optimized charging schedules that adapt to your usage patterns and grid needs."
    },
    {
      icon: TrendingUp,
      title: "Earn Rewards",
      description: "Get paid for every kWh you contribute back to the grid during peak hours."
    },
    {
      icon: Battery,
      title: "Battery Health",
      description: "Advanced protection algorithms ensure your EV battery stays healthy while trading."
    },
    {
      icon: Shield,
      title: "Secure Trading",
      description: "Blockchain-backed transactions ensure transparency and instant settlements."
    }
  ]

  return (
    <main className="bg-[var(--background)] relative overflow-x-hidden">
      {/* Soft Ambient Background */}
      <div className="fixed inset-0 pointer-events-none opacity-40 z-0">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-slate-400/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-green-400/20 rounded-full blur-[120px]" />
      </div>

      {/* ========== HERO SECTION ========== */}
      <section className="min-h-screen flex flex-col items-center justify-center relative z-10 p-6">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-center max-w-6xl mx-auto flex flex-col items-center"
        >
          {/* Interactive Grid Switch */}
          <div className="flex flex-col items-center gap-6 mb-12">
            <span className="text-gray-500 font-bold tracking-widest text-sm uppercase">
              {gridConnected ? 'Grid Connected' : 'Connect to Grid'}
            </span>
            <NeuSwitch
              checked={gridConnected}
              onChange={setGridConnected}
              hue={220}
            />
          </div>

          <h1 className="text-6xl md:text-9xl font-black tracking-tighter text-slate-700 mb-6 leading-tight select-none">
            POWER <span className="gradient-text">FUTURE</span>
          </h1>
          <p className="text-xl md:text-2xl text-slate-500 max-w-2xl mx-auto leading-relaxed font-medium mb-12">
            Turn your electric vehicle into a revenue-generating asset with our intelligent V2G trading platform.
          </p>

          <div className="flex flex-col sm:flex-row gap-8 justify-center items-center">
            <Link href="/dashboard" className="neu-btn group">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Start Trading
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>

            <div className="flex gap-4">
              {[1, 2, 3].map((_, i) => (
                <div key={i} className="neu-icon-btn cursor-pointer">
                  <Zap className="w-5 h-5 opacity-60" />
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </section>

      {/* ========== HORIZONTAL SCROLL SECTION ========== */}
      <section
        ref={sectionRef}
        className="relative z-20 h-screen flex items-center"
      >
        {/* Horizontal scroll container */}
        <div
          ref={scrollContainerRef}
          className="w-full h-full overflow-x-auto overflow-y-hidden flex items-center scrollbar-hide"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          <div className="flex gap-12 md:gap-24 pl-8 md:pl-24 pr-8 md:pr-24 items-center h-full">
            {/* Intro Panel */}
            <div className="w-[85vw] md:w-[50vw] flex-shrink-0 flex flex-col justify-center pr-8">
              <h2 className="text-5xl md:text-8xl font-black mb-8 text-slate-700 tracking-tighter leading-none">
                How It <br /><span className="gradient-text">Works</span>
              </h2>
              <p className="text-xl md:text-2xl text-slate-500 leading-relaxed max-w-lg font-medium">
                Seamlessly connect your EV. Stabilize the grid. Earn passive income.
              </p>
            </div>

            {/* Feature Cards */}
            {features.map((feature, i) => (
              <div
                key={i}
                className="w-[85vw] md:w-[400px] h-[70vh] md:h-[500px] flex-shrink-0 card flex flex-col justify-between group bg-white/60 backdrop-blur-sm relative overflow-hidden"
              >
                {/* Card number watermark */}
                <span className="absolute -top-4 -right-4 text-[12rem] font-black text-slate-100 select-none pointer-events-none leading-none">
                  {i + 1}
                </span>

                <div className="relative z-10">
                  <div className="neu-icon-btn w-16 h-16 md:w-20 md:h-20 rounded-2xl group-hover:scale-110 transition-transform bg-slate-100 mb-8">
                    <feature.icon className="w-8 h-8 md:w-10 md:h-10 text-slate-600" />
                  </div>
                </div>

                <div className="relative z-10 flex-1 flex flex-col justify-end">
                  <h3 className="text-3xl md:text-4xl font-bold mb-4 text-slate-700">{feature.title}</h3>
                  <p className="text-lg md:text-xl text-slate-500 leading-relaxed font-medium">
                    {feature.description}
                  </p>
                </div>

                <div className="h-2 md:h-3 w-full bg-slate-200/50 rounded-full overflow-hidden mt-8 neu-inset relative z-10">
                  <div className="h-full bg-gradient-to-r from-slate-500 to-green-500 w-0 group-hover:w-full transition-all duration-1000 ease-out" />
                </div>
              </div>
            ))}

            {/* End spacer */}
            <div className="w-[20vw] flex-shrink-0" />
          </div>
        </div>
      </section>

      {/* ========== BENEFITS SECTION ========== */}
      <section className="relative z-30 bg-[var(--background)] py-16 md:py-24">
        <div className="container-width px-6">
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16 md:mb-20"
          >
            <h2 className="text-4xl md:text-7xl font-black text-slate-700 mb-6 tracking-tighter">
              Why Choose <span className="gradient-text">V2G?</span>
            </h2>
            <p className="text-xl md:text-2xl text-slate-500 max-w-3xl mx-auto font-medium">
              Transform your electric vehicle into a smart energy asset that works for you 24/7
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8 md:gap-12 mb-20">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="card text-center group"
            >
              <div className="neu-icon-btn w-20 h-20 mx-auto mb-6 group-hover:scale-110 transition-transform">
                <TrendingUp className="w-10 h-10 text-green-500" />
              </div>
              <h3 className="text-2xl font-black text-slate-700 mb-4">Passive Income</h3>
              <p className="text-slate-500 font-medium leading-relaxed">
                Earn money while your EV is parked. Our AI optimizes trading to maximize your returns automatically.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="card text-center group"
            >
              <div className="neu-icon-btn w-20 h-20 mx-auto mb-6 group-hover:scale-110 transition-transform">
                <Leaf className="w-10 h-10 text-green-500" />
              </div>
              <h3 className="text-2xl font-black text-slate-700 mb-4">Grid Stability</h3>
              <p className="text-slate-500 font-medium leading-relaxed">
                Contribute to a more resilient energy grid. Your EV helps balance supply and demand in real-time.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="card text-center group"
            >
              <div className="neu-icon-btn w-20 h-20 mx-auto mb-6 group-hover:scale-110 transition-transform">
                <Shield className="w-10 h-10 text-green-500" />
              </div>
              <h3 className="text-2xl font-black text-slate-700 mb-4">Battery Protection</h3>
              <p className="text-slate-500 font-medium leading-relaxed">
                Advanced algorithms protect your battery health. We never compromise longevity for profit.
              </p>
            </motion.div>
          </div>

          {/* Stats Section */}
          <div className="grid md:grid-cols-4 gap-6 md:gap-8 mb-20">
            {[
              { icon: Users, value: "10K+", label: "Active Users" },
              { icon: Battery, value: "50M+", label: "kWh Traded" },
              { icon: Zap, value: "₹2.5M+", label: "Earnings Generated" },
              { icon: Clock, value: "24/7", label: "Automated Trading" }
            ].map((stat, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="neu-inset p-6 md:p-8 text-center"
              >
                <stat.icon className="w-8 h-8 md:w-10 md:h-10 text-green-500 mx-auto mb-4" />
                <div className="text-3xl md:text-4xl font-black text-slate-700 mb-2">{stat.value}</div>
                <div className="text-sm md:text-base text-slate-500 font-medium">{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ========== FOOTER CTA SECTION ========== */}
      <section className="relative z-30 flex items-center justify-center bg-[var(--background)] py-20">
        <div className="container-width text-center px-6">
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="card max-w-4xl mx-auto p-8 md:p-16"
          >
            <h2 className="text-3xl md:text-6xl font-black text-slate-700 mb-6 md:mb-8">
              Ready to <span className="gradient-text">Join the Grid?</span>
            </h2>
            <p className="text-lg md:text-xl text-slate-500 mb-8 md:mb-12 max-w-2xl mx-auto">
              Start contributing to a sustainable energy future while earning passively from your parked EV.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 md:gap-6 justify-center">
              <Link href="/dashboard" className="neu-btn group w-full sm:w-auto justify-center text-base md:text-lg py-4">
                Launch Dashboard
                <Zap className="w-5 h-5 fill-current" />
              </Link>
              <button className="neu-btn w-full sm:w-auto justify-center text-base md:text-lg py-4 text-slate-500 hover:text-slate-700">
                Contact Sales
              </button>
            </div>

            <div className="mt-12 md:mt-16 pt-8 border-t border-slate-200/50 flex flex-col md:flex-row justify-between items-center text-slate-400 text-sm gap-4">
              <p>© 2024 V2G Simulation. All rights reserved.</p>
              <div className="flex gap-6">
                <a href="#" className="hover:text-slate-600 transition-colors">Privacy</a>
                <a href="#" className="hover:text-slate-600 transition-colors">Terms</a>
                <a href="#" className="hover:text-slate-600 transition-colors">Twitter</a>
              </div>
            </div>
          </motion.div>
        </div>
      </section>
    </main>
  )
}
