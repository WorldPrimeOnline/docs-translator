-- Add structured translation AST column to translations table.
-- Populated by the Railway worker after translateToAst() succeeds.
-- Null for jobs processed before this migration or when AST generation fails.
ALTER TABLE translations ADD COLUMN IF NOT EXISTS translated_ast jsonb;
