#!/usr/bin/env bash
# Avisa o Bing (e demais buscadores que participam do IndexNow) sobre URLs novas ou alteradas.
# Rode DEPOIS do deploy, pois o buscador confere o arquivo-chave em https://leonam.io/be16dc3d4c1e670f7d464641f3c758b4.txt
#
# Uso:  tools/indexnow.sh            # envia todas as URLs do sitemap publicado
#       tools/indexnow.sh URL [URL…] # envia somente as URLs informadas
set -euo pipefail

HOST="leonam.io"
KEY="be16dc3d4c1e670f7d464641f3c758b4"
KEY_LOCATION="https://${HOST}/${KEY}.txt"

if [ "$#" -gt 0 ]; then
  URLS=("$@")
else
  URLS=()
  while IFS= read -r line; do URLS+=("$line"); done < <(curl -fsSL "https://${HOST}/sitemap.xml" | grep -o '<loc>[^<]*' | sed 's/<loc>//')
fi

[ "${#URLS[@]}" -gt 0 ] || { echo "Nenhuma URL para enviar" >&2; exit 1; }

JSON_URLS=$(printf '%s\n' "${URLS[@]}" | python3 -c 'import sys,json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')

curl -fsS -X POST "https://api.indexnow.org/indexnow" \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d "{\"host\":\"${HOST}\",\"key\":\"${KEY}\",\"keyLocation\":\"${KEY_LOCATION}\",\"urlList\":${JSON_URLS}}" \
  -w '\nHTTP %{http_code} — %{size_upload} bytes enviados\n'
echo "Enviadas ${#URLS[@]} URL(s)."
