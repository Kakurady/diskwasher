-- Up
--------
create table "files" (
    "fullpath"  text primary key,
    "size"      integer,
    "mtime"     integer,
    "mtime_frac"     integer,
    "sha512"    blob
);
-- Down
--------
drop table "files";