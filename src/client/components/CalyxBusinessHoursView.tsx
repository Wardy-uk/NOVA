import { useState } from 'react';
import { C, cardStyle, inputStyle, selectStyle, btnPrimary, btnSecondary, labelStyle, EmptyState, SlidePanel, calyxApi, useCalyxData } from './calyx-shared.js';

interface Schedule {
  day_of_week: number;
  start_time: string;
  end_time: string;
  enabled: 0 | 1;
}

interface Holiday {
  id: number;
  name: string;
  date: string;
}

interface BusinessHoursProfile {
  id: number;
  name: string;
  timezone: string;
  schedules: Schedule[];
  holidays: Holiday[];
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ORDERED_DAYS = [1, 2, 3, 4, 5, 6, 0]; // Mon–Sun

function getScheduleForDay(schedules: Schedule[], dow: number): Schedule | undefined {
  return schedules.find(s => s.day_of_week === dow);
}

function timeToFraction(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h + m / 60) / 24;
}

function defaultSchedules(): Schedule[] {
  return ORDERED_DAYS.map(dow => ({
    day_of_week: dow,
    start_time: '09:00',
    end_time: '17:00',
    enabled: (dow >= 1 && dow <= 5 ? 1 : 0) as 0 | 1,
  }));
}

export function CalyxBusinessHoursView() {
  const { data: profiles, loading, reload } = useCalyxData<BusinessHoursProfile[]>('/business-hours');
  const [editing, setEditing] = useState<BusinessHoursProfile | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit form state
  const [formName, setFormName] = useState('');
  const [formTimezone, setFormTimezone] = useState('');
  const [formSchedules, setFormSchedules] = useState<Schedule[]>(defaultSchedules());
  const [formHolidays, setFormHolidays] = useState<Holiday[]>([]);
  const [newHolidayName, setNewHolidayName] = useState('');
  const [newHolidayDate, setNewHolidayDate] = useState('');

  function openNew() {
    setIsNew(true);
    setFormName('');
    setFormTimezone('Europe/London');
    setFormSchedules(defaultSchedules());
    setFormHolidays([]);
    setEditing({} as BusinessHoursProfile);
  }

  function openEdit(p: BusinessHoursProfile) {
    setIsNew(false);
    setFormName(p.name);
    setFormTimezone(p.timezone);
    // Ensure all 7 days exist in the form
    const schedules = ORDERED_DAYS.map(dow => {
      const existing = p.schedules.find(s => s.day_of_week === dow);
      return existing ? { ...existing } : { day_of_week: dow, start_time: '09:00', end_time: '17:00', enabled: 0 as 0 | 1 };
    });
    setFormSchedules(schedules);
    setFormHolidays(p.holidays.map(h => ({ ...h })));
    setEditing(p);
  }

  function closePanel() {
    setEditing(null);
    setNewHolidayName('');
    setNewHolidayDate('');
  }

  function updateSchedule(dow: number, field: string, value: any) {
    setFormSchedules(prev => prev.map(s =>
      s.day_of_week === dow ? { ...s, [field]: value } : s
    ));
  }

  function addHoliday() {
    if (!newHolidayName.trim() || !newHolidayDate) return;
    setFormHolidays(prev => [...prev, { id: -Date.now(), name: newHolidayName.trim(), date: newHolidayDate }]);
    setNewHolidayName('');
    setNewHolidayDate('');
  }

  function removeHoliday(idx: number) {
    setFormHolidays(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (isNew) {
        const createRes = await calyxApi<{ id: number }>('/business-hours', {
          method: 'POST',
          body: JSON.stringify({ name: formName, timezone: formTimezone }),
        });
        if (createRes.ok && createRes.data) {
          await calyxApi(`/business-hours/${createRes.data.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ schedules: formSchedules, holidays: formHolidays }),
          });
        }
      } else if (editing?.id) {
        await calyxApi(`/business-hours/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: formName,
            timezone: formTimezone,
            schedules: formSchedules,
            holidays: formHolidays,
          }),
        });
      }
      closePanel();
      reload();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editing?.id) return;
    setSaving(true);
    try {
      await calyxApi(`/business-hours/${editing.id}`, { method: 'DELETE' });
      closePanel();
      reload();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div style={{ padding: 32, color: C.text3 }}>Loading business hours...</div>;

  const list = profiles || [];

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.text1 }}>Business Hours</h2>
        <button style={btnPrimary} onClick={openNew}>New Profile</button>
      </div>

      {/* Card grid */}
      {list.length === 0 ? (
        <EmptyState icon="inbox" title="No business hours profiles" subtitle="Create a profile to define working hours and holidays" />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: 16 }}>
          {list.map(p => (
            <div key={p.id} style={cardStyle}>
              {/* Name + timezone */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: C.text1 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: C.text3, marginTop: 2 }}>{p.timezone}</div>
              </div>

              {/* Day grid */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                {ORDERED_DAYS.map(dow => {
                  const sched = getScheduleForDay(p.schedules, dow);
                  const enabled = sched?.enabled === 1;
                  const startFrac = enabled && sched ? timeToFraction(sched.start_time) : 0;
                  const endFrac = enabled && sched ? timeToFraction(sched.end_time) : 0;
                  const widthPct = enabled ? Math.max(0, (endFrac - startFrac)) * 100 : 100;

                  return (
                    <div key={dow} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 30, fontSize: 12, color: C.text2, fontWeight: 600, flexShrink: 0 }}>
                        {DAY_LABELS[dow]}
                      </span>
                      <div style={{ flex: 1, position: 'relative', height: 20, display: 'flex', alignItems: 'center' }}>
                        <div style={{
                          position: 'absolute',
                          left: enabled ? `${startFrac * 100}%` : 0,
                          width: `${widthPct}%`,
                          height: 8,
                          borderRadius: 4,
                          background: enabled ? C.teal : `${C.text3}30`,
                        }} />
                      </div>
                      <span style={{ fontSize: 11, color: enabled ? C.text2 : C.text3, whiteSpace: 'nowrap', width: 90, textAlign: 'right' }}>
                        {enabled && sched ? `${sched.start_time} \u2013 ${sched.end_time}` : 'Closed'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Holidays */}
              {p.holidays.length > 0 && (
                <div style={{ fontSize: 11, color: C.text3, marginBottom: 14, lineHeight: 1.6 }}>
                  {p.holidays.map((h, i) => (
                    <span key={h.id}>
                      {i > 0 && ', '}
                      {h.name} ({h.date})
                    </span>
                  ))}
                </div>
              )}

              {/* Edit button */}
              <button style={btnSecondary} onClick={() => openEdit(p)}>Edit</button>
            </div>
          ))}
        </div>
      )}

      {/* Edit / Create panel */}
      <SlidePanel open={!!editing} onClose={closePanel} title={isNew ? 'New Profile' : 'Edit Profile'} width={560}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Name */}
          <div>
            <label style={labelStyle}>Name</label>
            <input style={inputStyle} value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. UK Business Hours" />
          </div>

          {/* Timezone */}
          <div>
            <label style={labelStyle}>Timezone</label>
            <input style={inputStyle} value={formTimezone} onChange={e => setFormTimezone(e.target.value)} placeholder="e.g. Europe/London" />
          </div>

          {/* Schedules */}
          <div>
            <label style={labelStyle}>Schedule</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ORDERED_DAYS.map(dow => {
                const sched = formSchedules.find(s => s.day_of_week === dow);
                const enabled = sched?.enabled === 1;
                return (
                  <div key={dow} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={e => updateSchedule(dow, 'enabled', e.target.checked ? 1 : 0)}
                      style={{ cursor: 'pointer', accentColor: C.teal }}
                    />
                    <span style={{ width: 36, fontSize: 13, color: C.text1, fontWeight: 600 }}>{DAY_LABELS[dow]}</span>
                    <input
                      type="time"
                      value={sched?.start_time || '09:00'}
                      onChange={e => updateSchedule(dow, 'start_time', e.target.value)}
                      disabled={!enabled}
                      style={{
                        ...inputStyle,
                        width: 120,
                        padding: '4px 8px',
                        fontSize: 12,
                        opacity: enabled ? 1 : 0.35,
                      }}
                    />
                    <span style={{ color: C.text3, fontSize: 12 }}>to</span>
                    <input
                      type="time"
                      value={sched?.end_time || '17:00'}
                      onChange={e => updateSchedule(dow, 'end_time', e.target.value)}
                      disabled={!enabled}
                      style={{
                        ...inputStyle,
                        width: 120,
                        padding: '4px 8px',
                        fontSize: 12,
                        opacity: enabled ? 1 : 0.35,
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Holidays */}
          <div>
            <label style={labelStyle}>Holidays</label>
            {formHolidays.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                {formHolidays.map((h, idx) => (
                  <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.text1 }}>
                    <span style={{ flex: 1 }}>{h.name}</span>
                    <span style={{ color: C.text3, fontSize: 12 }}>{h.date}</span>
                    <button
                      onClick={() => removeHoliday(idx)}
                      style={{ background: 'none', border: 'none', color: C.text3, cursor: 'pointer', fontSize: 16, padding: '0 4px' }}
                    >&times;</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                style={{ ...inputStyle, flex: 1 }}
                value={newHolidayName}
                onChange={e => setNewHolidayName(e.target.value)}
                placeholder="Holiday name"
              />
              <input
                type="date"
                style={{ ...inputStyle, width: 150 }}
                value={newHolidayDate}
                onChange={e => setNewHolidayDate(e.target.value)}
              />
              <button
                style={{ ...btnSecondary, padding: '8px 14px', whiteSpace: 'nowrap' as const }}
                onClick={addHoliday}
              >Add</button>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
            <button style={btnPrimary} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button style={btnSecondary} onClick={closePanel}>Cancel</button>
            {!isNew && (
              <button
                style={{ marginLeft: 'auto', background: 'none', border: 'none', color: C.red, cursor: 'pointer', fontSize: 13 }}
                onClick={handleDelete}
                disabled={saving}
              >Delete Profile</button>
            )}
          </div>
        </div>
      </SlidePanel>
    </div>
  );
}
