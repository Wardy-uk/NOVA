import React, { useEffect, useState, useCallback } from 'react';
import type { PortalKbArticle } from '../../../shared/portal-types.js';

const pf = (window as any).__portalFetch as (path: string, opts?: RequestInit) => Promise<Response>;

interface ArticleResult {
  id: number;
  title: string;
  excerpt: string;
  category: string | null;
  labels: string | null;
  helpfulScore: number;
}

export default function PortalKnowledgeBase() {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<ArticleResult[]>([]);
  const [categories, setCategories] = useState<Array<{ category: string; count: number }>>([]);
  const [selectedArticle, setSelectedArticle] = useState<PortalKbArticle | null>(null);
  const [loading, setLoading] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState<Record<number, boolean>>({});

  useEffect(() => {
    pf('/api/portal/kb/categories')
      .then(r => r.json())
      .then(data => { if (data.ok) setCategories(data.data); })
      .catch(console.error);
  }, []);

  const handleSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await pf(`/api/portal/kb/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (data.ok) setResults(data.data.articles || []);
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => handleSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search, handleSearch]);

  const openArticle = async (id: number) => {
    try {
      const res = await pf(`/api/portal/kb/articles/${id}`);
      const data = await res.json();
      if (data.ok) setSelectedArticle(data.data);
    } catch (err) {
      console.error('Failed to load article:', err);
    }
  };

  const submitFeedback = async (id: number, helpful: boolean) => {
    try {
      await pf(`/api/portal/kb/articles/${id}/feedback`, {
        method: 'POST',
        body: JSON.stringify({ helpful }),
      });
      setFeedbackGiven(prev => ({ ...prev, [id]: true }));
    } catch { /* ignore */ }
  };

  if (selectedArticle) {
    return (
      <div className="max-w-3xl mx-auto">
        <button
          onClick={() => setSelectedArticle(null)}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Knowledge Base
        </button>

        <div className="bg-white rounded-xl border border-gray-200 p-8">
          {selectedArticle.category && (
            <span className="inline-block text-xs px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 mb-3">
              {selectedArticle.category}
            </span>
          )}
          <h1 className="text-2xl font-bold text-gray-900 mb-6">{selectedArticle.title}</h1>
          <div
            className="prose prose-sm max-w-none text-gray-700"
            dangerouslySetInnerHTML={{ __html: selectedArticle.body_html }}
          />

          {/* Helpfulness */}
          <div className="mt-8 pt-6 border-t border-gray-100">
            {feedbackGiven[selectedArticle.id] ? (
              <p className="text-sm text-gray-500">Thanks for your feedback!</p>
            ) : (
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-600">Was this article helpful?</span>
                <button
                  onClick={() => submitFeedback(selectedArticle.id, true)}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-green-50 hover:border-green-300 transition-colors"
                >
                  Yes
                </button>
                <button
                  onClick={() => submitFeedback(selectedArticle.id, false)}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-red-50 hover:border-red-300 transition-colors"
                >
                  No
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 text-center mb-4">Knowledge Base</h1>
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search articles..."
            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
            autoFocus
          />
        </div>
      </div>

      {/* Search Results */}
      {search.length >= 2 && (
        <div className="max-w-2xl mx-auto">
          {loading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="bg-white rounded-lg p-4 animate-pulse border border-gray-200">
                  <div className="h-5 w-3/4 bg-gray-200 rounded mb-2" />
                  <div className="h-4 w-full bg-gray-100 rounded" />
                </div>
              ))}
            </div>
          ) : results.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No articles found for "{search}"</p>
              <p className="text-sm mt-1">Try different keywords or browse by category below.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {results.map(a => (
                <button
                  key={a.id}
                  onClick={() => openArticle(a.id)}
                  className="w-full text-left bg-white rounded-lg p-4 border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{a.title}</div>
                      <div className="text-xs text-gray-500 mt-1 line-clamp-2">{a.excerpt}</div>
                    </div>
                    {a.category && (
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full flex-shrink-0">
                        {a.category}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Categories (show when not searching) */}
      {search.length < 2 && categories.length > 0 && (
        <div className="max-w-2xl mx-auto">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Browse by Category</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {categories.map(c => (
              <button
                key={c.category}
                onClick={() => setSearch(c.category)}
                className="bg-white rounded-xl border border-gray-200 p-4 text-left hover:border-blue-300 hover:shadow-sm transition-all"
              >
                <div className="text-sm font-medium text-gray-900">{c.category}</div>
                <div className="text-xs text-gray-500 mt-1">{c.count} article{c.count !== 1 ? 's' : ''}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
