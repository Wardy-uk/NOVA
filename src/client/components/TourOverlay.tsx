import { useState, useEffect, useCallback } from 'react';

interface TourStep {
  target: string; // CSS selector for the element to highlight
  title: string;
  description: string;
  position: 'bottom' | 'top' | 'left' | 'right';
}

const TOUR_STEPS: TourStep[] = [
  {
    target: '[data-area="command"]',
    title: 'My NOVA',
    description: 'Your command centre hub. Tabs: Dashboard (KPIs & charts), Ask NOVA (AI assistant), Chat (conversational AI), My Focus (priority tasks & starred deliveries), Standup (AI morning briefing), and Team Load (per-person workload overview).',
    position: 'bottom',
  },
  {
    target: '[data-area="servicedesk"]',
    title: 'Service Desk',
    description: 'View and manage Jira service desk tickets. Tabs: Dashboard (KPI overview with SLA & assignee breakdowns), Tickets (sortable list with ownership filters), Kanban (drag cards between columns to transition in Jira), and Calendar (monthly view with drag-to-reschedule).',
    position: 'bottom',
  },
  {
    target: '[data-area="onboarding"]',
    title: 'Onboarding',
    description: 'Track the delivery pipeline and customer onboarding. Tabs: Delivery (milestones, xlsx/SharePoint sync, starred items), Onboarding Calendar (monthly milestone grid), and Config (ticket automation matrix for new setups).',
    position: 'bottom',
  },
  {
    target: '[data-area="accounts"]',
    title: 'Account Management',
    description: 'Dynamics 365 CRM integration. View customer health (RAG status), track MRR across your portfolio, log business reviews, and sync or purge accounts from D365.',
    position: 'bottom',
  },
  {
    target: '[data-tour="user-menu"]',
    title: 'Settings & Admin',
    description: 'My Settings for personal integrations, Jira OAuth, and AI key. Admin panel for users, teams, roles, permissions, audit log, and onboarding config. The notification bell shows alerts for overdue milestones and SLA breaches. Plus the Help guide and Feedback form.',
    position: 'left',
  },
];

const STORAGE_KEY = 'nova_tour_completed';

export function TourOverlay({ show, onClose }: { show: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const currentStep = TOUR_STEPS[step];

  const updateTargetRect = useCallback(() => {
    if (!currentStep) return;
    const el = document.querySelector(currentStep.target);
    if (el) {
      setTargetRect(el.getBoundingClientRect());
    } else {
      setTargetRect(null);
    }
  }, [currentStep]);

  useEffect(() => {
    if (!show) return;
    updateTargetRect();
    window.addEventListener('resize', updateTargetRect);
    return () => window.removeEventListener('resize', updateTargetRect);
  }, [show, step, updateTargetRect]);

  const handleNext = () => {
    if (step < TOUR_STEPS.length - 1) {
      setStep(step + 1);
    } else {
      finish();
    }
  };

  const handlePrev = () => {
    if (step > 0) setStep(step - 1);
  };

  const finish = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setStep(0);
    onClose();
  };

  if (!show || !currentStep) return null;

  // Tooltip position
  const pad = 12;
  let tooltipStyle: React.CSSProperties = { position: 'fixed', zIndex: 10001 };
  if (targetRect) {
    switch (currentStep.position) {
      case 'bottom':
        tooltipStyle.top = targetRect.bottom + pad;
        tooltipStyle.left = Math.max(16, targetRect.left + targetRect.width / 2 - 160);
        break;
      case 'top':
        tooltipStyle.bottom = window.innerHeight - targetRect.top + pad;
        tooltipStyle.left = Math.max(16, targetRect.left + targetRect.width / 2 - 160);
        break;
      case 'left':
        tooltipStyle.top = targetRect.top;
        tooltipStyle.right = window.innerWidth - targetRect.left + pad;
        break;
      case 'right':
        tooltipStyle.top = targetRect.top;
        tooltipStyle.left = targetRect.right + pad;
        break;
    }
  } else {
    // Fallback to center
    tooltipStyle.top = '50%';
    tooltipStyle.left = '50%';
    tooltipStyle.transform = 'translate(-50%, -50%)';
  }

  return (
    <div className="fixed inset-0 z-[10000]">
      {/* Backdrop with spotlight cutout */}
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={targetRect.left - 4}
                y={targetRect.top - 4}
                width={targetRect.width + 8}
                height={targetRect.height + 8}
                rx={8}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%" height="100%"
          fill="rgba(0,0,0,0.7)"
          mask="url(#tour-mask)"
          style={{ pointerEvents: 'auto' }}
          onClick={finish}
        />
      </svg>

      {/* Highlight ring around target */}
      {targetRect && (
        <div
          className="absolute border-2 border-[#5ec1ca] rounded-lg pointer-events-none animate-pulse"
          style={{
            left: targetRect.left - 4,
            top: targetRect.top - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
            zIndex: 10001,
          }}
        />
      )}

      {/* Tooltip */}
      <div
        className="bg-[#2f353d] border border-[#5ec1ca]/50 rounded-lg shadow-xl w-80 p-4"
        style={tooltipStyle}
      >
        <div className="text-xs text-[#5ec1ca] font-semibold mb-1">
          Step {step + 1} of {TOUR_STEPS.length}
        </div>
        <div className="text-sm text-neutral-100 font-semibold mb-2">{currentStep.title}</div>
        <div className="text-xs text-neutral-400 leading-relaxed mb-4">{currentStep.description}</div>

        <div className="flex items-center justify-between">
          <button
            onClick={finish}
            className="text-[11px] text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            Skip tour
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <button
                onClick={handlePrev}
                className="px-3 py-1.5 text-[11px] rounded bg-[#272C33] text-neutral-400 hover:text-neutral-200 border border-[#3a424d] transition-colors"
              >
                Back
              </button>
            )}
            <button
              onClick={handleNext}
              className="px-4 py-1.5 text-[11px] rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9] transition-colors"
            >
              {step === TOUR_STEPS.length - 1 ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>

        {/* Progress dots */}
        <div className="flex justify-center gap-1.5 mt-3">
          {TOUR_STEPS.map((_, i) => (
            <div
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                i === step ? 'bg-[#5ec1ca]' : i < step ? 'bg-[#5ec1ca]/40' : 'bg-neutral-600'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function useTour() {
  const [showTour, setShowTour] = useState(false);

  const startTour = useCallback(() => setShowTour(true), []);
  const closeTour = useCallback(() => setShowTour(false), []);

  // Check if tour should auto-show on first visit
  const checkFirstVisit = useCallback(() => {
    if (localStorage.getItem(STORAGE_KEY) !== 'true') {
      // Small delay to let the UI render
      setTimeout(() => setShowTour(true), 1500);
    }
  }, []);

  return { showTour, startTour, closeTour, checkFirstVisit };
}
