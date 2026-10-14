const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Match ordered name fragments, allowing omitted separators and characters. */
export function matchesDatasetSearch(dataset: { title: string; id: string }, query: string): boolean {
    const needle = [...normalize(query)];
    return [dataset.title, dataset.id].some(value => {
        let matched = 0;
        for (const character of normalize(value)) {
            if (character === needle[matched]) matched++;
        }
        return matched === needle.length;
    });
}
