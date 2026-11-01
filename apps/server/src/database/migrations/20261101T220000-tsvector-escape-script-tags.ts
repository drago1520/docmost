import { type Kysely, sql } from 'kysely';

// The default text search parser treats a literal "<script>" or "<style>" in
// page text as the start of a block and skips everything up to the closing tag,
// so the rest of the page was never indexed. Breaking "<" with a space keeps
// the parser from ever seeing a tag.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE OR REPLACE FUNCTION pages_tsvector_trigger() RETURNS trigger AS $$
    begin
        new.tsv :=
                  setweight(to_tsvector('english', f_unaccent(replace(coalesce(new.title, ''), '<', '< '))), 'A') ||
                  setweight(to_tsvector('english', f_unaccent(replace(substring(coalesce(new.text_content, ''), 1, 1000000), '<', '< '))), 'B');
        return new;
    end;
    $$ LANGUAGE plpgsql;
  `.execute(db);

  // reindex only the pages that could have been cut short
  await sql`
    UPDATE pages SET text_content = text_content
    WHERE text_content LIKE '%<%' OR title LIKE '%<%'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE OR REPLACE FUNCTION pages_tsvector_trigger() RETURNS trigger AS $$
    begin
        new.tsv :=
                  setweight(to_tsvector('english', f_unaccent(coalesce(new.title, ''))), 'A') ||
                  setweight(to_tsvector('english', f_unaccent(substring(coalesce(new.text_content, ''), 1, 1000000))), 'B');
        return new;
    end;
    $$ LANGUAGE plpgsql;
  `.execute(db);
}
