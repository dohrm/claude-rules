using System.Collections.Immutable;
using System.Linq;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Diagnostics;

namespace Factory.Godot.Analyzers
{
    /// <summary>
    /// GODOT003 — GetNode / GetNodeOrNull called with a string-literal path. Prefer an exported,
    /// typed handle ([Export] Node2D / NodePath resolved once). String paths are the untyped hole
    /// C# was chosen to close. Sound. See rules/godot-csharp/architecture.md.
    /// </summary>
    [DiagnosticAnalyzer(LanguageNames.CSharp)]
    public sealed class StringNodePathAnalyzer : DiagnosticAnalyzer
    {
        public const string DiagnosticId = "GODOT003";

        private static readonly DiagnosticDescriptor Rule = new DiagnosticDescriptor(
            DiagnosticId,
            title: "String node path",
            messageFormat: "'{0}' with a string-literal path — wire the node with an [Export] typed handle instead",
            category: "Architecture",
            defaultSeverity: DiagnosticSeverity.Warning,
            isEnabledByDefault: true,
            description: "Resolve node dependencies via exported typed handles, not string paths (rules/godot-csharp/architecture.md).");

        public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics => ImmutableArray.Create(Rule);

        public override void Initialize(AnalysisContext context)
        {
            context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
            context.EnableConcurrentExecution();
            context.RegisterSyntaxNodeAction(Analyze, SyntaxKind.InvocationExpression);
        }

        private static void Analyze(SyntaxNodeAnalysisContext context)
        {
            var inv = (InvocationExpressionSyntax)context.Node;

            var name = MethodName(inv.Expression);
            if (name != "GetNode" && name != "GetNodeOrNull") return;

            var firstArg = inv.ArgumentList.Arguments.FirstOrDefault();
            if (firstArg?.Expression is LiteralExpressionSyntax lit && lit.IsKind(SyntaxKind.StringLiteralExpression))
            {
                context.ReportDiagnostic(Diagnostic.Create(Rule, firstArg.GetLocation(), name));
            }
        }

        private static string? MethodName(ExpressionSyntax expr) => expr switch
        {
            MemberAccessExpressionSyntax m => m.Name.Identifier.Text,   // handles GetNode<T> (GenericNameSyntax) too
            SimpleNameSyntax s => s.Identifier.Text,
            _ => null,
        };
    }
}
