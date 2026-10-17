Deployment layer. See ../docs/DEPLOY.md for the full guide.

  .env.example       copy to .env and fill in
  preflight.sh       check a deployment before making it
  migrate.sh         apply supabase/migrations to any Postgres, once each
  selfhost.sh        stand up a pinned Supabase bundle on one VM
  Dockerfile         the BROC application image
  docker-compose.yml runs the app against whatever Supabase you have
