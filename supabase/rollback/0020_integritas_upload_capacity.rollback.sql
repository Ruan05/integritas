-- Roll back only the future-upload limit. Existing objects are preserved.
update storage.buckets
set file_size_limit = 5242880
where id = 'integritas-case-files';
