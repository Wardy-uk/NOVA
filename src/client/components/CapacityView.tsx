import { useState, useEffect } from 'react';

interface DayForecast {
  forecast_date: string; day_of_week: number; predicted_volume: number;
  confidence_low: number; confidence_high: number; actual_volume: number | null;
  team_capacity: number; surplus_deficit: number;
}

interface Accuracy { total: number; avg_error_pct: number | null }

const api = async (path: string, method = 'GET') => {
  const r = await fetch(`/api/capacity${path}`, {
    method,
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
  });
  return r.json();
};

const dayName = (dow: number) => ['', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow] ?? '';

export function CapacityView() {
  const [forecast, setForecast] = useState<DayForecast[]>([]);
  const [historical, setHistorical] = useState<DayForecast[]>([]);
  const [accuracy, setAccuracy] = useState<Accuracy | null>(null);
  const [generating, setGenerating] = useState(false);
  const [showTab, setShowTab] = useState<'forecast' | 'historical'>('forecast');

  const load = async () => {
    const [f, h, a] = await Promise.all([
      api('/forecast'), api('/historical?days=28'), api('/accuracy'),
    ]);
    if (f.ok) setForecast(f.data);
    if (h.ok) setHistorical(h.data);
    if (a.ok) setAccuracy(a.data);
  };

  useEffect(() => { load(); }, []);

  const generate = async () => {
    setGenerating(true);
    await api('/generate', 'POST');
    await load();
    setGenerating(false);
  };

  const cellColor = (surplus: number, capacity: number) => {
    if (capacity === 0) return 'bg-[#2f353d]';
    const ratio = surplus / capacity;
    if (ratio > 0.3) return 'bg-green-900/30';
    if (ratio > 0) return 'bg-amber-900/30';
    return 'bg-red-900/30';
  };

  const data = showTab === 'forecast' ? forecast : historical;

  return (
    <div className="space-y-6">
      {/* Accuracy + Controls */}
      <div className="flex items-center justify-between">
        <div className="flex gap-4">
          {accuracy && accuracy.total > 0 && (
            <div className="text-xs text-neutral-400">
              Forecast accuracy: <span className="text-neutral-200">{accuracy.avg_error_pct?.toFixed(1)}% avg error</span>
              <span className="text-neutral-500 ml-1">({accuracy.total} days measured)</span>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <div className="flex rounded overflow-hidden border border-[#3a424d]">
            <button onClick={() => setShowTab('forecast')}
              className={`px-3 py-1 text-xs ${showTab === 'forecast' ? 'bg-[#5ec1ca]/20 text-[#5ec1ca]' : 'bg-[#2f353d] text-neutral-400'}`}>
              Forecast
            </button>
            <button onClick={() => setShowTab('historical')}
              className={`px-3 py-1 text-xs ${showTab === 'historical' ? 'bg-[#5ec1ca]/20 text-[#5ec1ca]' : 'bg-[#2f353d] text-neutral-400'}`}>
              Historical
            </button>
          </div>
          <button onClick={generate} disabled={generating}
            className="px-3 py-1 bg-[#5ec1ca]/20 text-[#5ec1ca] text-xs rounded hover:bg-[#5ec1ca]/30 disabled:opacity-50">
            {generating ? 'Generating...' : 'Generate Forecast'}
          </button>
        </div>
      </div>

      {/* Capacity Heatmap */}
      <div className="grid grid-cols-7 gap-1">
        {data.filter(d => d.team_capacity > 0).map(d => (
          <div key={d.forecast_date}
            className={`${cellColor(d.surplus_deficit, d.team_capacity)} rounded-lg p-3 text-center`}>
            <div className="text-xs text-neutral-500">{dayName(d.day_of_week)}</div>
            <div className="text-xs text-neutral-400">{d.forecast_date.split('-').slice(1).join('/')}</div>
            <div className="text-lg font-bold text-neutral-200 mt-1">{d.predicted_volume}</div>
            <div className="text-xs text-neutral-500">
              {d.confidence_low}–{d.confidence_high}
            </div>
            {d.actual_volume !== null && (
              <div className="text-xs text-[#5ec1ca] mt-1">Actual: {d.actual_volume}</div>
            )}
            <div className={`text-xs mt-1 ${d.surplus_deficit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {d.surplus_deficit >= 0 ? '+' : ''}{d.surplus_deficit}
            </div>
          </div>
        ))}
      </div>

      {/* Summary Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#3a424d]">
              <th className="text-left py-2 px-2 text-neutral-400 font-medium">Date</th>
              <th className="text-left py-2 px-2 text-neutral-400 font-medium">Day</th>
              <th className="text-right py-2 px-2 text-neutral-400 font-medium">Predicted</th>
              <th className="text-right py-2 px-2 text-neutral-400 font-medium">Range</th>
              <th className="text-right py-2 px-2 text-neutral-400 font-medium">Actual</th>
              <th className="text-right py-2 px-2 text-neutral-400 font-medium">Capacity</th>
              <th className="text-right py-2 px-2 text-neutral-400 font-medium">Surplus</th>
            </tr>
          </thead>
          <tbody>
            {data.filter(d => d.team_capacity > 0).map(d => (
              <tr key={d.forecast_date} className="border-b border-[#3a424d]/50 hover:bg-[#2f353d]/50">
                <td className="py-2 px-2 text-neutral-300">{d.forecast_date}</td>
                <td className="py-2 px-2 text-neutral-400">{dayName(d.day_of_week)}</td>
                <td className="py-2 px-2 text-right text-neutral-200">{d.predicted_volume}</td>
                <td className="py-2 px-2 text-right text-neutral-500">{d.confidence_low}–{d.confidence_high}</td>
                <td className="py-2 px-2 text-right text-[#5ec1ca]">{d.actual_volume ?? '-'}</td>
                <td className="py-2 px-2 text-right text-neutral-400">{d.team_capacity}</td>
                <td className={`py-2 px-2 text-right ${d.surplus_deficit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {d.surplus_deficit >= 0 ? '+' : ''}{d.surplus_deficit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.length === 0 && (
        <div className="text-center text-neutral-500 text-sm py-8">
          No forecast data. Click "Generate Forecast" to create a 14-day volume prediction.
        </div>
      )}
    </div>
  );
}
