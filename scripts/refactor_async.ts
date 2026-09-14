import { Project, SyntaxKind, FunctionDeclaration } from 'ts-morph';

const project = new Project();
project.addSourceFilesAtPaths("src/**/*.ts");

const dbFile = project.getSourceFileOrThrow("src/db/database.ts");

console.log("Adding DatabaseAdapter import...");
dbFile.addImportDeclaration({
  namedImports: ["DatabaseAdapter"],
  moduleSpecifier: "./adapter"
});

const functions = dbFile.getFunctions();

for (const func of functions) {
  // Make function async
  if (!func.isAsync()) {
    func.setIsAsync(true);
  }

  // Wrap return type in Promise
  const returnTypeNode = func.getReturnTypeNode();
  if (returnTypeNode && returnTypeNode.getText() !== "void" && !returnTypeNode.getText().startsWith("Promise<")) {
    const returnTypeText = returnTypeNode.getText();
    func.setReturnType(`Promise<${returnTypeText}>`);
  } else if (!returnTypeNode || returnTypeNode.getText() === "void") {
    func.setReturnType("Promise<void>");
  }

  // Refactor body statements
  const statements = func.getStatements();
  
  let hasReplaced = true;
  while(hasReplaced) {
      hasReplaced = false;
      const stmts = func.getStatements();
      
      for (let i = 0; i < stmts.length; i++) {
        const stmtNode = stmts[i];
        const stmtText = stmtNode.getText();
        
        // Find: const stmt = db.prepare('...');
        if (stmtNode.getKind() === SyntaxKind.VariableStatement && stmtText.includes("db.prepare")) {
          const varDecl = stmtNode.getFirstDescendantByKind(SyntaxKind.VariableDeclaration);
          if (varDecl) {
             const init = varDecl.getInitializerIfKind(SyntaxKind.CallExpression);
             if (init && init.getExpression().getText() === "db.prepare") {
                const sqlArg = init.getArguments()[0];
                const sqlText = sqlArg.getText();
                const varName = varDecl.getName();
                
                // Now look for usages of varName in the following statements
                let replacedUsage = false;
                for (let j = i + 1; j < stmts.length; j++) {
                    const nextStmt = stmts[j];
                    const nextText = nextStmt.getText();
                    
                    if (nextText.includes(`${varName}.get`) || nextText.includes(`${varName}.all`) || nextText.includes(`${varName}.run`)) {
                        
                        let updatedText = nextText;
                        
                        // Handle .get(args)
                        const getRegex = new RegExp(`(?:return\\s+)?${varName}\\.get\\(([^)]*)\\)(?:\\s*as\\s+[^;]+)?;?`, 'g');
                        const getMatch = getRegex.exec(updatedText);
                        if (getMatch) {
                            const args = getMatch[1].trim() ? `[${getMatch[1]}]` : "[]";
                            
                            // It's a return statement?
                            if (nextStmt.getKind() === SyntaxKind.ReturnStatement) {
                                // Extract the 'as' cast if present
                                const asMatch = updatedText.match(/as\s+(.*);/);
                                const cast = asMatch ? ` as ${asMatch[1]}` : '';
                                updatedText = `return (await DatabaseAdapter.getInstance().query(${sqlText}, ${args}))[0]${cast};`;
                            } else {
                                updatedText = updatedText.replace(getRegex, `(await DatabaseAdapter.getInstance().query(${sqlText}, ${args}))[0]`);
                            }
                        }
                        
                        // Handle .all(args)
                        const allRegex = new RegExp(`(?:return\\s+)?${varName}\\.all\\(([^)]*)\\)(?:\\s*as\\s+[^;]+)?;?`, 'g');
                        const allMatch = allRegex.exec(updatedText);
                        if (allMatch) {
                            const args = allMatch[1].trim() ? `[${allMatch[1]}]` : "[]";
                            if (nextStmt.getKind() === SyntaxKind.ReturnStatement) {
                                const asMatch = updatedText.match(/as\s+(.*);/);
                                const cast = asMatch ? ` as ${asMatch[1]}` : '';
                                updatedText = `return (await DatabaseAdapter.getInstance().query(${sqlText}, ${args}))${cast};`;
                            } else {
                                updatedText = updatedText.replace(allRegex, `await DatabaseAdapter.getInstance().query(${sqlText}, ${args})`);
                            }
                        }
                        
                        // Handle .run(args)
                        const runRegex = new RegExp(`${varName}\\.run\\(([^)]*)\\);?`, 'g');
                        const runMatch = runRegex.exec(updatedText);
                        if (runMatch) {
                            const args = runMatch[1].trim() ? `[${runMatch[1]}]` : "[]";
                            updatedText = updatedText.replace(runRegex, `await DatabaseAdapter.getInstance().execute(${sqlText}, ${args});`);
                        }
                        
                        nextStmt.replaceWithText(updatedText);
                        replacedUsage = true;
                    }
                }
                
                if (replacedUsage) {
                    stmtNode.remove(); // Remove the db.prepare
                    hasReplaced = true;
                    break;
                }
             }
          }
        }
      }
  }
}

console.log("Saving changes to database.ts...");
project.saveSync();
console.log("Done.");
