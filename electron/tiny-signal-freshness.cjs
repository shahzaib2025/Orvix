function observationAt(snapshot, signal, target) {
    const key = ['disk_free_percent', 'file_exists', 'folder_new_file'].includes(signal) ? signal + ':' + target : signal;
    if (snapshot?.Observations && Object.hasOwn(snapshot.Observations, key)) {
        const value = snapshot.Observations[key];
        return value?.status === 'ready' ? value.at : 0;
    }
    return snapshot?.at;
}
module.exports = { observationAt };
