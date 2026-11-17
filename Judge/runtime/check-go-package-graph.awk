# Validate production go-list output, not the module's entire source archive.
# This guard does not suppress or reclassify scanner findings.
{
    count++
    if ($0 !~ /^[A-Za-z0-9_./!@+-]+$/ || seen[$0]++) invalid = 1
    if ($0 == "github.com/criyle/go-judge/cmd/go-judge") main++
    if ($0 ~ /^golang[.]org\/x\/crypto\/openpgp(\/|$)/) prohibited = 1
}
END {
    if (count == 0 || main != 1 || invalid || prohibited) {
        print "Invalid production package graph or prohibited OpenPGP dependency" > "/dev/stderr"
        exit 1
    }
    printf "Verified production Go package graph: %d packages; OpenPGP imports: 0\n", count
}
