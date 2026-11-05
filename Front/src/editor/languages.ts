import type { Language } from "../types";

// 제출 기록에 쓰는 LANGUAGE_LABELS와 달리 풀이 화면은 채점 버전까지 보여 주고 순서도 다르다.
export const languages: { value: Language; label: string; starter: string }[] = [
  {
    value: "PYTHON",
    label: "Python 3",
    starter:
      "def solution():\n    answer = 0\n    # 여기에 코드를 작성하세요.\n    return answer\n\n\nprint(solution())\n",
  },
  {
    value: "CPP",
    label: "C++ 20",
    starter:
      '#include <iostream>\n#include <string>\n#include <vector>\nusing namespace std;\n\nint solution() {\n    int answer = 0;\n    // 여기에 코드를 작성하세요.\n    return answer;\n}\n\nint main() {\n    cout << solution() << "\\n";\n    return 0;\n}\n',
  },
  {
    value: "C",
    label: "C 17",
    starter:
      '#include <stdio.h>\n\nint solution(void) {\n    int answer = 0;\n    // 여기에 코드를 작성하세요.\n    return answer;\n}\n\nint main(void) {\n    printf("%d\\n", solution());\n    return 0;\n}\n',
  },
  {
    value: "JAVA",
    label: "Java 21",
    starter:
      "import java.util.*;\n\npublic class Main {\n    static int solution(Scanner sc) {\n        int answer = 0;\n        // 여기에 코드를 작성하세요.\n        return answer;\n    }\n\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        System.out.println(solution(sc));\n    }\n}\n",
  },
  {
    value: "JAVASCRIPT",
    label: "JavaScript",
    starter:
      'const lines = require("fs").readFileSync(0, "utf8").trim().split("\\n");\n\nfunction solution() {\n  let answer = 0;\n  // 여기에 코드를 작성하세요.\n  return answer;\n}\n\nconsole.log(solution());\n',
  },
  {
    value: "TYPESCRIPT",
    label: "TypeScript",
    starter:
      'import * as fs from "fs";\nconst lines: string[] = fs.readFileSync(0, "utf8").trim().split("\\n");\n\nfunction solution(): number {\n  let answer = 0;\n  // 여기에 코드를 작성하세요.\n  return answer;\n}\n\nconsole.log(solution());\n',
  },
  {
    value: "GO",
    label: "Go",
    starter:
      'package main\n\nimport (\n    "bufio"\n    "fmt"\n    "os"\n)\n\nfunc solution(reader *bufio.Reader) int {\n    answer := 0\n    // 여기에 코드를 작성하세요.\n    return answer\n}\n\nfunc main() {\n    reader := bufio.NewReader(os.Stdin)\n    fmt.Println(solution(reader))\n}\n',
  },
  {
    value: "RUST",
    label: "Rust",
    starter:
      'use std::io::{self, Read};\n\nfn solution(input: &str) -> i64 {\n    let answer: i64 = 0;\n    // 여기에 코드를 작성하세요.  (값을 바꾸려면 answer를 mut로 선언하세요)\n    let _ = input;\n    answer\n}\n\nfn main() {\n    let mut input = String::new();\n    io::stdin().read_to_string(&mut input).unwrap();\n    println!("{}", solution(&input));\n}\n',
  },
];

export const starter = (value: Language) =>
  languages.find((item) => item.value === value)?.starter ?? "";
