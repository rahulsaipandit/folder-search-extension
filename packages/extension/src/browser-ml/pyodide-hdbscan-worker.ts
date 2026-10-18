import { loadPyodide } from 'pyodide'

let pyodideReadyPromise: Promise<any> | null = null
let runHdbscanPy: ((...args: any[]) => any) | null = null

const PYTHON_CODE = `
import numpy as np
import scipy.sparse as sp
from sklearn.cluster import HDBSCAN
from sklearn.preprocessing import normalize
from sklearn.utils import check_array
from sklearn.feature_extraction.text import CountVectorizer, TfidfTransformer
from sklearn.utils.validation import FLOAT_DTYPES, check_is_fitted


class CTFIDFVectorizer(TfidfTransformer):
    def __init__(self, *args, **kwargs):
        super(CTFIDFVectorizer, self).__init__(*args, **kwargs)
        self._idf_diag = None

    def fit(self, X, n_samples: int):
        X = check_array(X, accept_sparse=('csr', 'csc'))
        if not sp.issparse(X):
            X = sp.csr_matrix(X)
        dtype = X.dtype if X.dtype in FLOAT_DTYPES else np.float64
        _, n_features = X.shape
        df = np.squeeze(np.asarray(X.sum(axis=0)))
        df[df == 0] = 1
        avg_nr_samples = int(X.sum(axis=1).mean())
        if avg_nr_samples <= 0:
            avg_nr_samples = 1
        idf = np.log(avg_nr_samples / df)
        self._idf_diag = sp.diags(idf, offsets=0, shape=(n_features, n_features), format='csr', dtype=dtype)
        self.idf_ = np.asarray(idf)
        return self

    def transform(self, X, copy=True):
        X = check_array(X, accept_sparse='csr', dtype=FLOAT_DTYPES, copy=copy)
        if not sp.issparse(X):
            X = sp.csr_matrix(X, dtype=np.float64)
        n_samples, n_features = X.shape
        check_is_fitted(self, attributes=["idf_"], msg='idf vector is not fitted')
        expected_n_features = self._idf_diag.shape[0]
        if n_features != expected_n_features:
            raise ValueError("Input has n_features=%d while the model has been trained with n_features=%d" % (n_features, expected_n_features))
        X = X * self._idf_diag
        if self.norm:
            X = normalize(X, axis=1, norm='l1', copy=False)
        return X


def _adaptive_df_params(num_clusters):
    import math
    n = max(num_clusters, 1)
    min_df = max(1, min(8, int(math.log2(n))))
    if n < 3:
        max_df = 1.0
    else:
        log_n = math.log2(n)
        max_df = max(0.60, 1.0 - log_n / (log_n + 5.0))
    return min_df, max_df


def _build_ctfidf(aggregated_docs, n_samples, min_df=1, max_df=1.0):
    try:
        vectorizer = CountVectorizer(min_df=min_df, max_df=max_df)
        counts = vectorizer.fit_transform(aggregated_docs)
    except ValueError:
        return None
    if counts.shape[1] == 0:
        return None
    transformer = CTFIDFVectorizer(norm='l1')
    ctfidf = transformer.fit_transform(counts, n_samples=n_samples)
    feature_names = np.array(vectorizer.get_feature_names_out())
    return ctfidf, feature_names


def _extract_top_keywords(ctfidf, feature_names, idx, top_n):
    row = ctfidf.getrow(idx)
    if row.nnz == 0:
        return [], []
    scores = row.toarray().flatten()
    if scores.size == 0:
        return [], []
    order = np.argsort(scores)[::-1]
    keywords = []
    scores_list = []
    for i in order[:top_n]:
        if scores[i] <= 0:
            break
        keywords.append(feature_names[i])
        scores_list.append(float(scores[i]))
    return keywords, scores_list


def compute_cluster_keywords(documents, labels, top_n_metadata=10, top_n_viz=3):
    if documents is None or labels is None:
        return {"metadata_keywords": {}, "keyword_scores": {}, "viz_keywords": {}}
    clustered_docs = {}
    for doc, label in zip(documents, labels):
        if label == -1:
            continue
        text = str(doc) if doc is not None else ""
        if not text.strip():
            continue
        clustered_docs.setdefault(label, []).append(text)
    if not clustered_docs:
        return {"metadata_keywords": {}, "keyword_scores": {}, "viz_keywords": {}}
    cluster_ids = sorted(clustered_docs.keys())
    aggregated_docs = [" ".join(clustered_docs[c]) for c in cluster_ids]
    num_clusters = len(cluster_ids)
    n_samples = len(documents)
    min_df, max_df = _adaptive_df_params(num_clusters)
    primary = _build_ctfidf(aggregated_docs, n_samples, min_df=min_df, max_df=max_df)
    fallback = None
    if min_df > 1 or max_df < 1.0:
        fallback = _build_ctfidf(aggregated_docs, n_samples, min_df=1, max_df=1.0)
    metadata_keywords = {}
    keyword_scores = {}
    viz_keywords = {}
    for idx, cluster_id in enumerate(cluster_ids):
        keywords, scores_list = [], []
        if primary is not None:
            keywords, scores_list = _extract_top_keywords(primary[0], primary[1], idx, top_n_metadata)
        if not keywords and fallback is not None:
            keywords, scores_list = _extract_top_keywords(fallback[0], fallback[1], idx, top_n_metadata)
        if not keywords:
            continue
        cluster_key = str(cluster_id)
        metadata_keywords[cluster_key] = keywords
        keyword_scores[cluster_key] = [{"keyword": kw, "score": score} for kw, score in zip(keywords, scores_list)]
        viz_keywords[cluster_key] = keywords[:top_n_viz]
    return {"metadata_keywords": metadata_keywords, "keyword_scores": keyword_scores, "viz_keywords": viz_keywords}


def run_hdbscan(data, min_cluster_size, min_samples, metric, documents=None, keyword_options=None):
    arr = np.asarray(data, dtype=np.float32)
    if arr.ndim != 2:
        raise ValueError("Expected 2D array for clustering")
    model = HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric=metric,
        algorithm='auto',
        cluster_selection_method='leaf'
    )
    labels = model.fit_predict(arr)
    outlier_scores = model.outlier_scores_ if hasattr(model, 'outlier_scores_') else None
    result = {
        "labels": labels.tolist(),
        "probabilities": model.probabilities_.tolist(),
        "outlier_scores": outlier_scores.tolist() if outlier_scores is not None else None
    }
    if documents is not None:
        meta_top_n = 10
        viz_top_n = 3
        if keyword_options:
            try:
                meta_top_n = int(keyword_options.get("metadata_top_n", meta_top_n))
            except (TypeError, ValueError):
                meta_top_n = 10
            try:
                viz_top_n = int(keyword_options.get("viz_top_n", viz_top_n))
            except (TypeError, ValueError):
                viz_top_n = 3
        keyword_info = compute_cluster_keywords(documents, labels, top_n_metadata=meta_top_n, top_n_viz=viz_top_n)
        result["cluster_keywords"] = keyword_info.get("metadata_keywords", {})
        result["cluster_keyword_scores"] = keyword_info.get("keyword_scores", {})
        result["cluster_keywords_viz"] = keyword_info.get("viz_keywords", {})
    return result
`

async function initPyodide(): Promise<any> {
	const indexURL =
		typeof chrome !== 'undefined' && chrome.runtime?.getURL
			? chrome.runtime.getURL('pyodide/')
			: 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/'

	const pyodide = await loadPyodide({ indexURL })
	await pyodide.loadPackage(['numpy', 'scikit-learn', 'scipy'], { messageCallback: () => {} })
	await pyodide.runPythonAsync(PYTHON_CODE)
	runHdbscanPy = pyodide.globals.get('run_hdbscan')
	return pyodide
}

function ensurePyodide(): Promise<any> {
	if (!pyodideReadyPromise) {
		pyodideReadyPromise = initPyodide()
			.then(pyodide => {
				self.postMessage({ type: 'ready' })
				return pyodide
			})
			.catch(error => {
				self.postMessage({ type: 'error', id: null, error: error?.message || String(error) })
				throw error
			})
	}
	return pyodideReadyPromise
}

;(self as any).onmessage = async (event: MessageEvent) => {
	const { type, id, payload } = event.data

	if (type === 'init') {
		try { await ensurePyodide() } catch { /* error already posted */ }
		return
	}

	if (type === 'run') {
		try {
			const pyodide = await ensurePyodide()
			const { data, minClusterSize, minSamples, metric, documents, keywordOptions } = payload
			const pyData = pyodide.toPy(data)
			let pyDocuments: any = null
			let pyKeywordOptions: any = null

			try {
				const args: any[] = [pyData, minClusterSize, minSamples, metric]

				if (Array.isArray(documents)) {
					pyDocuments = pyodide.toPy(documents)
					args.push(pyDocuments)
					if (keywordOptions && typeof keywordOptions === 'object') {
						pyKeywordOptions = pyodide.toPy(keywordOptions)
						args.push(pyKeywordOptions)
					}
				}

				const result = runHdbscanPy!(...args)
				const jsResult = result.toJs({ dict_converter: Object.fromEntries })
				result.destroy()
				self.postMessage({ type: 'result', id, result: jsResult })
			} finally {
				pyData.destroy()
				pyDocuments?.destroy()
				pyKeywordOptions?.destroy()
			}
		} catch (error: any) {
			self.postMessage({ type: 'error', id, error: error?.message || String(error) })
		}
	}
}

ensurePyodide()
