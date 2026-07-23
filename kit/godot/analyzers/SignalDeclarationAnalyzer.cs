using System.Collections.Immutable;
using System.Linq;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Diagnostics;

namespace Factory.Godot.Analyzers
{
    /// <summary>
    /// GODOT002 — a [Signal] delegate declared outside the EventBus class. Cross-domain signals
    /// belong on the single typed EventBus, extended in place. Sound: this is a pure structural
    /// fact, no heuristics. See rules/godot-csharp/event-bus.md.
    /// </summary>
    [DiagnosticAnalyzer(LanguageNames.CSharp)]
    public sealed class SignalDeclarationAnalyzer : DiagnosticAnalyzer
    {
        public const string DiagnosticId = "GODOT002";

        private static readonly DiagnosticDescriptor Rule = new DiagnosticDescriptor(
            DiagnosticId,
            title: "Signal declared outside EventBus",
            messageFormat: "[Signal] '{0}' is declared outside EventBus — cross-domain signals belong on the single typed EventBus",
            category: "Architecture",
            defaultSeverity: DiagnosticSeverity.Warning,
            isEnabledByDefault: true,
            description: "Extend the EventBus, never duplicate the signal list elsewhere (rules/godot-csharp/event-bus.md).");

        public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics => ImmutableArray.Create(Rule);

        public override void Initialize(AnalysisContext context)
        {
            context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
            context.EnableConcurrentExecution();
            context.RegisterSyntaxNodeAction(Analyze, SyntaxKind.DelegateDeclaration);
        }

        private static void Analyze(SyntaxNodeAnalysisContext context)
        {
            var del = (DelegateDeclarationSyntax)context.Node;

            var hasSignal = del.AttributeLists
                .SelectMany(l => l.Attributes)
                .Any(a =>
                {
                    var n = a.Name.ToString();
                    return n == "Signal" || n == "SignalAttribute" || n.EndsWith(".Signal") || n.EndsWith(".SignalAttribute");
                });
            if (!hasSignal) return;

            var typeDecl = del.FirstAncestorOrSelf<TypeDeclarationSyntax>();
            if (typeDecl is null) return;
            if (typeDecl.Identifier.Text == "EventBus") return;

            context.ReportDiagnostic(Diagnostic.Create(Rule, del.Identifier.GetLocation(), del.Identifier.Text));
        }
    }
}
